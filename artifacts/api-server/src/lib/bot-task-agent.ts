/**
 * Telegram AI Saydman — vazifa yaratish (aniq parse → to‘liq tasdiq → yaratish).
 * Bir vazifa tugamaguncha boshqa oqimga o‘tmaydi. Davomatga yozish YO‘Q.
 */
import { and, ilike, ne, or } from "drizzle-orm";
import { db, employeesTable, tasksTable } from "@workspace/db";
import { notifyUser } from "./notify";
import { publicAppUrl } from "./telegram";
import { logger } from "./logger";
import type { LinkedPlatformUser } from "./personal-bot-context";

const TASK_ASSIGN_BLOCKED = new Set(["farmasevt", "stajyor"]);

export function canBotAssignTasks(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  if (!r) return false;
  return !TASK_ASSIGN_BLOCKED.has(r);
}

export const ATTENDANCE_WRITE_BLOCKED_REPLY = [
  "Tushundim. Men keldim/ketdimni chatdan belgilay olmayman — bu xavfsizlik qoidasi.",
  "Siz Face ID yoki QR orqali o‘zingiz qayd etasiz.",
  "Muammo: kamera/GPS ruxsati va filial hududini tekshiring.",
  "Skrinshot yuborsangiz — nima bo‘layotganini aytaman.",
  "Men AI Saydman.",
].join("\n");

export const ATTENDANCE_TROUBLE_REPLY = [
  "Davomat ochilmasa / saqlanmasa — shu chatda yordam beraman.",
  "Tekshiring: 1) internet 2) kamera/GPS 3) filial yaqinida 4) to‘g‘ri smena.",
  "Men Keldim/Ketdimni o‘rniga yozmayman, lekin xatoni tushuntiraman.",
  "Skrinshot yuboring yoki qaysi tugma ishlamasligini yozing.",
  "Men AI Saydman.",
].join("\n");

export function looksAttendanceWriteRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  return /keldimni\s*(belgila|qo.?y|yoz)|ketdimni\s*(belgila|qo.?y|yoz)|davomatni\s*(tuzat|o'?zgart|qo.?sh|o'?chir|yarat)|kechagi\s*davomatni|boshqa.*(keldim|ketdim)|qo.?lda\s*(keldim|ketdim|davomat)|davomat\s*yozib\s*ber/.test(
    t,
  );
}

export function looksTaskCreateIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /zadacha\s*yarat|vazifa\s*(qo.?y|yarat|ber)|topshiriq\s*(ber|qo.?y|yarat)|mendan\s+topshiriq|meng(a|dan)\s+.*topshiriq|falon.*(vazifa|zadacha)|xodimga\s*(vazifa|topshiriq)/.test(
    t,
  );
}

export type TaskDraft = {
  position?: string;
  fullName?: string;
  content?: string;
  dueRaw?: string;
  dueAt?: Date | null;
  assigneeEmployeeId?: number;
  assigneeUserId?: number | null;
  assigneeLabel?: string;
  /** Tasdiq so‘ralgan — keyingi «Ha» yaratadi */
  awaitingConfirm?: boolean;
  confirmed?: boolean;
};

const drafts = new Map<string, { draft: TaskDraft; at: number }>();
const DRAFT_TTL = 45 * 60_000;

function getDraft(key: string): TaskDraft {
  const now = Date.now();
  const cur = drafts.get(key);
  if (cur && now - cur.at < DRAFT_TTL) return cur.draft;
  const d: TaskDraft = {};
  drafts.set(key, { draft: d, at: now });
  return d;
}

function saveDraft(key: string, d: TaskDraft) {
  drafts.set(key, { draft: d, at: Date.now() });
}

export function clearTaskDraft(key: string) {
  drafts.delete(key);
}

export function hasActiveTaskDraft(sessionKey: string): boolean {
  const cur = drafts.get(sessionKey);
  if (!cur || Date.now() - cur.at > DRAFT_TTL) return false;
  const d = cur.draft;
  return Boolean(
    d.position || d.fullName || d.content || d.dueAt || d.awaitingConfirm || d.assigneeEmployeeId,
  );
}

function missingFields(d: TaskDraft): string[] {
  const m: string[] = [];
  if (!d.position?.trim()) m.push("Xodimning lavozimi");
  if (!d.fullName?.trim()) m.push("Ismi va familiyasi");
  if (!d.content?.trim()) m.push("Vazifa mazmuni");
  if (!d.dueAt) m.push("Bajarish muddati (sana va soat, masalan 18.11.2026 soat 18:00)");
  return m;
}

/**
 * Muddat: avval sana (dd.mm.yyyy), keyin alohida soat (HH:MM).
 * «18.11.2026 18:00» da 18.11 ni soat deb olmaslik.
 */
export function parseDueAtUz(raw: string, now = new Date()): Date | null {
  const t = raw.trim().toLowerCase().replace(/[‘’ʻ`]/g, "'");

  let y = 0;
  let mo = 0;
  let d = 0;
  const dmY = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmY) {
    d = Number(dmY[1]);
    mo = Number(dmY[2]);
    y = Number(dmY[3]);
  } else if (/bugun|bugün/.test(t)) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(now).split("-");
    y = Number(p[0]);
    mo = Number(p[1]);
    d = Number(p[2]);
  } else if (/ertaga/.test(t)) {
    const base = new Date(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(now) + "T12:00:00+05:00",
    );
    const tomorrow = new Date(base.getTime() + 86400000);
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" })
      .format(tomorrow)
      .split("-");
    y = Number(p[0]);
    mo = Number(p[1]);
    d = Number(p[2]);
  } else {
    return null;
  }

  // Sana qismini olib tashlab, qolganidan soatni olish
  const withoutDate = dmY ? t.replace(dmY[0], " ") : t;
  const hm =
    withoutDate.match(/soat\s*(\d{1,2})[:.\s](\d{2})/) ||
    withoutDate.match(/\b(\d{1,2}):(\d{2})\b/) ||
    withoutDate.match(/\b(\d{1,2})\.(\d{2})\b(?!\d)/);

  if (!hm) return null;
  const hour = Number(hm[1]);
  const minute = Number(hm[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;

  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function looksPersonNameLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 5 || s.length > 80) return false;
  if (/\d/.test(s)) return false;
  if (/lavozim|muddat|vazifa|topshiriq|zadacha|yarat|hisobot|kerak|soat|bajarish|menga|mendan/i.test(s)) {
    return false;
  }
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  // Kamida 2 ta so‘z — bosh harf yoki lotin/kirill ism
  return words.every((w) => /^[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳʼ'’-]+$/.test(w));
}

function looksPositionLine(line: string): boolean {
  const s = line.toLowerCase();
  return /hr|mudir|farmasevt|stajyor|koordinator|menejer|manager|direktor|ombor|sb|kassir|boshliq|ofis|rekruter|auditor/.test(
    s,
  );
}

/** Bir xabardan (ko‘p qator) barcha maydonlarni chiqarish */
export function extractFromMessage(text: string, draft: TaskDraft): TaskDraft {
  const next: TaskDraft = { ...draft };
  const rawLines = text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Tasdiq / rad — faqat qisqa javob
  const only = text.replace(/\s+/g, " ").trim();
  if (/^(ha|xa|tasdiq|ok|yarat|yes)\b/i.test(only) && only.length < 24) {
    next.confirmed = true;
    return next;
  }
  if (/^(yo'?q|bekor|cancel|no)\b/i.test(only) && only.length < 24) {
    next.confirmed = false;
    return next;
  }

  for (const line of rawLines) {
    // Skip intent-only lines
    if (/^(mendan\s+)?(topshiriq|vazifa|zadacha)\s*yarat/i.test(line) && line.length < 40) {
      continue;
    }

    // Lavozim(i) hr menejer | Lavozim: ...
    const lav =
      line.match(/^(?:lavozim(?:i)?|position|rol(?:i)?)\s*[:\-–]?\s*(.+)$/i) ||
      line.match(/^lavozim(?:i)?\s+(.+)$/i);
    if (lav) {
      next.position = lav[1]!.trim().replace(/^[:\-–]\s*/, "");
      continue;
    }

    // Muddat
    const mud =
      line.match(/^(?:bajarish\s*)?(?:muddat(?:i)?|due|deadline)\s*[:\-–]?\s*(.+)$/i) ||
      line.match(/(?:bajarish\s*)?muddat(?:i)?\s+(.+)$/i);
    if (mud || /\d{1,2}[./]\d{1,2}[./]\d{4}/.test(line)) {
      const dueSrc = mud ? mud[1]! : line;
      const due = parseDueAtUz(dueSrc);
      if (due) {
        next.dueRaw = dueSrc.trim();
        next.dueAt = due;
        continue;
      }
    }

    // Vazifa / mazmun
    const maz = line.match(
      /^(?:vazifa|mazmun|topshiriq|zadacha|matn)\s*[:\-–]\s*(.+)$/i,
    );
    if (maz) {
      next.content = maz[1]!.trim();
      continue;
    }

    // Ism
    const ism = line.match(/^(?:ism|familiya|fio|xodim)\s*[:\-–]?\s*(.+)$/i);
    if (ism) {
      next.fullName = ism[1]!.trim();
      continue;
    }

    if (looksPersonNameLine(line)) {
      next.fullName = line.trim();
      continue;
    }

    // «menga tezda hisobot kerak» — mazmun
    if (
      !next.content &&
      line.length >= 8 &&
      /hisobot|tekshir|yoz|yubor|tayyorla|qil|kerak|vazifa|checklist|excel|pdf/i.test(line) &&
      !looksTaskCreateIntent(line)
    ) {
      next.content = line.trim().slice(0, 500);
      continue;
    }

    // Faqat lavozim so‘zi
    if (!next.position && looksPositionLine(line) && line.split(/\s+/).length <= 5) {
      const cleaned = line.replace(/^(?:lavozim(?:i)?)\s*[:\-–]?\s*/i, "").trim();
      next.position = cleaned || line.trim();
    }
  }

  // Butun matndan muddat (qatorlarda o‘tib ketgan bo‘lsa)
  if (!next.dueAt) {
    const due = parseDueAtUz(text);
    if (due) {
      next.dueRaw = text;
      next.dueAt = due;
    }
  }

  // Compact fallback: bitta qator javoblar
  if (rawLines.length === 1) {
    const line = rawLines[0]!;
    if (!next.fullName && looksPersonNameLine(line)) next.fullName = line;
    if (!next.position && looksPositionLine(line) && line.split(/\s+/).length <= 4) {
      next.position = line.replace(/^(?:lavozim(?:i)?)\s*[:\-–]?\s*/i, "").trim();
    }
    if (!next.content && line.length > 10 && !next.dueAt && !looksPersonNameLine(line)) {
      if (!looksTaskCreateIntent(line)) next.content = line.slice(0, 500);
    }
  }

  return next;
}

async function findEmployeesByName(fullName: string, position?: string) {
  const q = fullName.trim().replace(/\s+/g, " ");
  const parts = q.split(" ").filter(Boolean);
  const like = `%${q}%`;
  const rows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      orgRole: employeesTable.orgRole,
      location: employeesTable.location,
      userId: employeesTable.userId,
      status: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(
      and(
        or(ilike(employeesTable.fullName, like), ...parts.map((p) => ilike(employeesTable.fullName, `%${p}%`))),
        ne(employeesTable.employmentStatus, "dismissed"),
        ne(employeesTable.employmentStatus, "closed"),
      ),
    )
    .limit(8);

  let filtered = rows;
  if (position?.trim()) {
    const p = position.toLowerCase();
    const byPos = rows.filter(
      (r) =>
        String(r.position || "").toLowerCase().includes(p) ||
        String(r.orgRole || "").toLowerCase().includes(p) ||
        (p.includes("hr") && /hr/i.test(String(r.position || "") + String(r.orgRole || ""))),
    );
    if (byPos.length) filtered = byPos;
  }
  return filtered;
}

function askMissing(miss: string[], have: string[]): string {
  return [
    have.length ? `✅ Qabul qilindi:\n${have.join("\n")}\n` : "",
    "Hali yetishmayapti — yuboring:",
    ...miss.map((m) => `• ${m}`),
    "",
    "Birga yozishingiz mumkin, masalan:",
    "lavozimi hr menejer",
    "Nuraliyev Nurislom",
    "menga tezda hisobot kerak",
    "bajarish muddati 18.11.2026 18:00",
  ]
    .filter(Boolean)
    .join("\n");
}

function fmtDue(d: Date): string {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function summaryLines(d: TaskDraft): string[] {
  const have: string[] = [];
  if (d.position) have.push(`• Lavozim: ${d.position}`);
  if (d.fullName) have.push(`• Xodim: ${d.fullName}`);
  if (d.assigneeLabel) have.push(`• Topilgan: ${d.assigneeLabel}`);
  if (d.content) have.push(`• Vazifa: ${d.content}`);
  if (d.dueAt) have.push(`• Muddat: ${fmtDue(d.dueAt)}`);
  return have;
}

export async function handleTaskAgentTurn(opts: {
  sessionKey: string;
  text: string;
  actor: LinkedPlatformUser;
}): Promise<{ handled: boolean; reply: string }> {
  if (!canBotAssignTasks(opts.actor.role)) {
    if (looksTaskCreateIntent(opts.text)) {
      return {
        handled: true,
        reply:
          "Sizning rolingiz vazifa qo‘yish uchun ochiq emas. Admin/HR/mudir/koordinator orqali beriladi.",
      };
    }
    return { handled: false, reply: "" };
  }

  const key = opts.sessionKey;
  let draft = getDraft(key);
  const active = hasActiveTaskDraft(key);
  const starting = looksTaskCreateIntent(opts.text) || active;
  if (!starting) return { handled: false, reply: "" };

  // Bekor
  if (/^(bekor|cancel|toxta|to‘xta)/i.test(opts.text.trim()) || /vazifa(ni)?\s*bekor/i.test(opts.text)) {
    clearTaskDraft(key);
    return { handled: true, reply: "Vazifa yaratish bekor qilindi. Yangi uchun «topshiriq yarat» deb yozing." };
  }

  // Draft ochiq, lekin boshqa mavzu — yaratishni yopib, oddiy javobga o‘tkazamiz
  if (
    active &&
    !looksTaskCreateIntent(opts.text) &&
    !draft.awaitingConfirm &&
    /^(salom|assalom)|davomat|oylik|jarima|kirish|parol|men\s*(qo.?ygan|bergan)|vazifalarim|zadachalarim|qr\b|majburiyat|face\s*id|pdf\b/i.test(
      opts.text.trim(),
    )
  ) {
    clearTaskDraft(key);
    return { handled: false, reply: "" };
  }

  // Agar tasdiq kutilayotgan bo‘lsa — faqat ha/yo‘q
  if (draft.awaitingConfirm && !/^(ha|xa|tasdiq|ok|yarat|yes|yo'?q|bekor|no)\b/i.test(opts.text.trim())) {
    const have = summaryLines(draft);
    return {
      handled: true,
      reply: [
        "Hozir birinchi vazifani yakunlaymiz — boshqa ishga o‘tmayman.",
        "",
        "Tasdiqlang:",
        ...have,
        "",
        "«Ha» — yarataman · «Yo‘q» — bekor.",
      ].join("\n"),
    };
  }

  draft = extractFromMessage(opts.text, draft);

  if (draft.confirmed === false) {
    clearTaskDraft(key);
    return { handled: true, reply: "Yaratish bekor qilindi. Yangidan: «topshiriq yarat»." };
  }

  const miss = missingFields(draft);
  if (miss.length) {
    draft.awaitingConfirm = false;
    draft.confirmed = undefined;
    saveDraft(key, draft);
    return {
      handled: true,
      reply: askMissing(miss, summaryLines(draft)),
    };
  }

  // Xodimni topish
  if (!draft.assigneeEmployeeId) {
    const found = await findEmployeesByName(draft.fullName!, draft.position);
    const num = opts.text.trim().match(/^(\d{1,2})$/);
    if (num && found.length) {
      const pick = found[Number(num[1]) - 1];
      if (pick) {
        draft.assigneeEmployeeId = pick.id;
        draft.assigneeUserId = pick.userId;
        draft.assigneeLabel = `${pick.fullName} (${pick.position || pick.orgRole || "—"})`;
      }
    } else if (!found.length) {
      saveDraft(key, draft);
      return {
        handled: true,
        reply: [
          ...summaryLines(draft),
          "",
          `«${draft.fullName}» bazada topilmadi.`,
          "Ism-familiyani aniqroq yozing (yoki filial bilan).",
          "Hozirgi vazifa tugamaguncha boshqa ishga o‘tmayman.",
        ].join("\n"),
      };
    } else if (found.length > 1) {
      saveDraft(key, draft);
      const list = found
        .map(
          (f, i) =>
            `${i + 1}) ${f.fullName} — ${f.position || f.orgRole || "—"} · ${f.location || "—"}`,
        )
        .join("\n");
      return {
        handled: true,
        reply: [
          "Bir nechta xodim topildi. Qaysi biri? Faqat raqam yozing:",
          list,
          "",
          "Shu vazifa tugamaguncha keyingisiga o‘tmayman.",
        ].join("\n"),
      };
    } else {
      const one = found[0]!;
      draft.assigneeEmployeeId = one.id;
      draft.assigneeUserId = one.userId;
      draft.assigneeLabel = `${one.fullName} (${one.position || one.orgRole || "—"})`;
    }
  }

  if (!draft.assigneeEmployeeId) {
    saveDraft(key, draft);
    return { handled: true, reply: "Xodimni tanlash uchun ro‘yxatdan raqam yozing." };
  }

  if (draft.assigneeUserId && draft.assigneeUserId === opts.actor.id) {
    clearTaskDraft(key);
    return { handled: true, reply: "O‘zingizga vazifa qo‘yib bo‘lmaydi." };
  }

  // To‘liq tasdiq
  if (!draft.confirmed) {
    draft.awaitingConfirm = true;
    saveDraft(key, draft);
    return {
      handled: true,
      reply: [
        "Hammasi aniqmi? Tasdiqlasangiz yarataman:",
        "",
        `• Xodim: ${draft.assigneeLabel}`,
        `• Lavozim: ${draft.position}`,
        `• Vazifa: ${draft.content}`,
        `• Muddat: ${fmtDue(draft.dueAt!)}`,
        `• Kimdan: ${opts.actor.fullName}`,
        "",
        "✅ «Ha» — yarataman",
        "❌ «Yo‘q» — bekor",
        "",
        "Shu vazifa yakunlanmaguncha boshqa topshiriqqa o‘tmayman.",
      ].join("\n"),
    };
  }

  // Yaratish — UI ro‘yxati user:ID ni afzal ko‘radi (akkaunti bor xodim)
  try {
    const useUser =
      draft.assigneeUserId != null &&
      Number.isFinite(draft.assigneeUserId) &&
      draft.assigneeUserId > 0;
    const assigneeKind = useUser ? ("user" as const) : ("employee" as const);
    const assigneeId = useUser ? draft.assigneeUserId! : draft.assigneeEmployeeId!;

    const [created] = await db
      .insert(tasksTable)
      .values({
        title: String(draft.content).trim().slice(0, 200),
        description: `AI Saydman orqali.\nLavozim: ${draft.position}\nYaratuvchi: ${opts.actor.fullName}\nBajaruvchi: ${draft.assigneeLabel}`,
        status: "todo",
        priority: "normal",
        dueAt: draft.dueAt!,
        assigneeKind,
        assigneeId,
        createdById: opts.actor.id,
        attachments: [],
        meta: {
          source: "telegram_ai_saydman",
          createdByRole: opts.actor.role,
          assigneeEmployeeId: draft.assigneeEmployeeId,
          assigneeLabel: draft.assigneeLabel,
        },
      })
      .returning();

    const origin = publicAppUrl().replace(/\/$/, "") || "https://vaksinahr.uz";
    const link = `${origin}/vazifalar?task=${created!.id}`;

    const notifyUid = useUser ? draft.assigneeUserId! : draft.assigneeUserId;
    if (notifyUid) {
      await notifyUser({
        userId: notifyUid,
        title: "Yangi vazifa",
        text: String(draft.content).slice(0, 200),
        type: "task",
        linkUrl: `/vazifalar?task=${created!.id}`,
      }).catch(() => undefined);
    }

    clearTaskDraft(key);
    return {
      handled: true,
      reply: [
        "✅ Vazifa yaratildi va xodimga biriktirildi.",
        "",
        `• Xodim: ${draft.assigneeLabel}`,
        `• Lavozim: ${draft.position}`,
        `• Vazifa: ${draft.content}`,
        `• Muddat: ${fmtDue(draft.dueAt!)}`,
        `• Holat: ${created!.status}`,
        "",
        `Havola: ${link}`,
        "",
        "Men AI Saydman. Keyingi vazifa uchun yana «topshiriq yarat» deb yozing.",
      ].join("\n"),
    };
  } catch (err) {
    logger.warn({ err }, "bot-task-agent: create");
    draft.awaitingConfirm = true;
    draft.confirmed = undefined;
    saveDraft(key, draft);
    return {
      handled: true,
      reply: "Yaratishda xato bo‘ldi. «Ha» deb qayta urinib ko‘ring yoki /vazifalar dan qo‘ying.",
    };
  }
}
