/**
 * Telegramga ulangan xodimning FAQAT o‘z akkaunti bo‘yicha jonli baza konteksti.
 * Boshqa odamlar ma’lumoti chiqmaydi.
 */
import { eq } from "drizzle-orm";
import { db, employeesTable, pool, usersTable } from "@workspace/db";
import { buildUserSnapshot } from "./ai-assistant";
import { logger } from "./logger";

export type LinkedPlatformUser = {
  id: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  status: string;
  telegramId: string | null;
};

export async function findLinkedUserByTelegram(
  telegramUserId: string,
): Promise<LinkedPlatformUser | null> {
  const tid = String(telegramUserId || "").trim();
  if (!tid) return null;
  try {
    const [u] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        login: usersTable.login,
        phone: usersTable.phone,
        status: usersTable.status,
        telegramId: usersTable.telegramId,
      })
      .from(usersTable)
      .where(eq(usersTable.telegramId, tid))
      .limit(1);
    return u ?? null;
  } catch (err) {
    logger.warn({ err }, "personal-bot: find user");
    return null;
  }
}

async function loadMyOpenTasks(userId: number): Promise<string> {
  try {
    const { rows } = await pool.query<{
      id: number;
      title: string;
      status: string;
      priority: string | null;
      due_at: Date | null;
    }>(
      `
      SELECT t.id, t.title, t.status, t.priority, t.due_at
        FROM tasks t
        LEFT JOIN employees e ON t.assignee_kind = 'employee' AND e.id = t.assignee_id
       WHERE t.status IN ('todo', 'in_progress', 'done')
         AND t.candidate_id IS NULL
         AND t.pipeline_stage IS NULL
         AND t.title !~* '^[0-9]+-qadam'
         AND (
           CASE WHEN t.assignee_kind = 'employee' THEN e.user_id ELSE t.assignee_id END
         ) = $1
       ORDER BY
         CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
         t.due_at NULLS LAST,
         t.id DESC
       LIMIT 15
      `,
      [userId],
    );
    if (!rows.length) {
      return "Topshiriqlar (faqat sizniki): hozir ochiq topshiriq YO‘Q.";
    }
    const fmt = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const lines = rows.map((r) => {
      const due = r.due_at ? `, muddat=${fmt.format(new Date(r.due_at))}` : "";
      const pr = r.priority && r.priority !== "normal" ? `, ustuvor=${r.priority}` : "";
      return `• #${r.id} «${String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 120)}» holat=${r.status}${pr}${due}`;
    });
    const open = rows.filter((r) => r.status === "todo" || r.status === "in_progress").length;
    return `Topshiriqlar (faqat sizniki, ${rows.length} ta, ochiq=${open}):\n${lines.join("\n")}`;
  } catch (err) {
    logger.warn({ err }, "personal-bot: tasks");
    return "Topshiriqlar: hozir o‘qib bo‘lmadi.";
  }
}

async function loadMyShift(userId: number): Promise<string | null> {
  try {
    const [emp] = await db
      .select({
        shiftType: employeesTable.shiftType,
        shiftLabel: employeesTable.shiftLabel,
        assignedBranchId: employeesTable.assignedBranchId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp) return null;
    const type = emp.shiftType || "—";
    const label = (emp.shiftLabel || "").trim();
    return `Smena (faqat sizniki): turi=${type}${label ? `, yorliq=${label}` : ""}${
      emp.assignedBranchId ? `, filial_id=${emp.assignedBranchId}` : ""
    }`;
  } catch {
    return null;
  }
}

/**
 * Gemini / bot uchun: faqat shu telegram akkauntiga bog‘langan xodim bazasi.
 */
export async function buildPersonalBotContext(telegramUserId: string): Promise<{
  linked: boolean;
  user: LinkedPlatformUser | null;
  text: string;
}> {
  const user = await findLinkedUserByTelegram(telegramUserId);
  if (!user) {
    return {
      linked: false,
      user: null,
      text: [
        "AKKAUNT ULANMAGAN.",
        "Bu odamning shaxsiy topshiriq/davomat/oylik ma’lumotini BERMA.",
        "Ayting: avval @vaksinahrbot orqali login+parol bilan akkauntni ulang, keyin shaxsiy savol bering.",
      ].join("\n"),
    };
  }

  const parts: string[] = [
    `ULANGAN AKKAUNT (faqat shu odam): ${user.fullName} | id=${user.id} | rol=${user.role} | login=${user.login} | holat=${user.status}`,
    "QOIDА: javobda FAQAT shu odamning ma’lumoti. Boshqa xodim/filial/odam haqida gapirma.",
  ];

  try {
    const snapshot = await buildUserSnapshot(user);
    if (snapshot) parts.push(snapshot);
  } catch (err) {
    logger.warn({ err }, "personal-bot: snapshot");
  }

  parts.push(await loadMyOpenTasks(user.id));

  const shift = await loadMyShift(user.id);
  if (shift) parts.push(shift);

  try {
    const { buildOylikContextBlock, formatTasksHumanReminder } = await import("./bot-staff-reports");
    parts.push(await buildOylikContextBlock(user));
    parts.push(
      "TOPSHIRIQLAR (odamdek eslat): " +
        (await formatTasksHumanReminder(user.id)).replace(/<[^>]+>/g, ""),
    );
  } catch {
    /* ignore */
  }

  return { linked: true, user, text: parts.join("\n\n") };
}

/** Savol shaxsiy ma’lumotga tegishlimi (topshiriq, davomat, oylik…) */
export function looksPersonalDataQuestion(text: string): boolean {
  const q = text.toLowerCase();
  return /topshiriq|vazifa|task|davomat|keldim|ketdim|bugun\s*kel|smena|oylik|maosh|jarima|blok|javob\s*ol|atestat|testim|mening|menda|bor\s*mi|qancha|holat|profil|filialim|akkaunt|majburiyat|baho\s*qr|mijoz.*qr|qaytarib|kechik|ushlab|pdf|hisob/.test(
    q,
  );
}
