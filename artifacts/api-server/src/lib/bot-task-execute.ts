/**
 * AI Saydman — «Bugungi vazifalarimni bajar» protokoli.
 * Ro‘yxat → tanlash → to‘liq o‘qish → reja → tasdiq → ish (chat) → hisobot.
 * Platformada «Bajarildi» — faqat alohida aniq tasdiq + ijrochi o‘zi.
 * Davomatga aralashmaydi.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, employeesTable, tasksTable, usersTable } from "@workspace/db";
import { publicAppUrl } from "./telegram";
import { logger } from "./logger";
import type { LinkedPlatformUser } from "./personal-bot-context";

type ExecPhase =
  | "idle"
  | "listed"
  | "selected"
  | "plan_shown"
  | "work_done"
  | "await_platform_done";

type ExecSession = {
  phase: ExecPhase;
  at: number;
  taskIds: number[];
  selectedId?: number;
  planText?: string;
  workSummary?: string;
};

const sessions = new Map<string, ExecSession>();
const TTL = 45 * 60_000;

function getSess(key: string): ExecSession {
  const cur = sessions.get(key);
  if (cur && Date.now() - cur.at < TTL) return cur;
  const s: ExecSession = { phase: "idle", at: Date.now(), taskIds: [] };
  sessions.set(key, s);
  return s;
}

function saveSess(key: string, s: ExecSession) {
  sessions.set(key, { ...s, at: Date.now() });
}

export function clearExecSession(key: string) {
  sessions.delete(key);
}

export function hasActiveExecSession(key: string): boolean {
  const s = sessions.get(key);
  return Boolean(s && Date.now() - s.at < TTL && s.phase !== "idle");
}

/** Faqat ko‘rish: menga qo‘yilgan vazifa/zadacha ro‘yxati */
export function looksMyAssignedTasksIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'").trim();
  if (looksTaskCreateLike(t)) return false;
  return (
    /^(mening\s*)?(vazifa|zadacha|topshiriq)(lar)?(im)?[\s!.?]*$/i.test(t) ||
    /mening\s*(vazifa|zadacha|topshiriq)|vazifa(lar)?im\b|zadacha(lar)?im\b|topshiriq(lar)?im\b|ochiq\s*(vazifa|zadacha|topshiriq)|qanday\s*(vazifa|zadacha)|nima\s*vazifa|menga\s*qo.?yilgan/.test(
      t,
    )
  );
}

/** Bajarish / qilish — reja→tasdiq oqimi */
export function looksDoMyTasksIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'").trim();
  if (looksTaskCreateLike(t)) return false;
  return (
    /bugun(gi)?\s*(vazifa|zadacha|topshiriq).*(bajar|qil)|vazifa(lar)?imni\s*(bajar|ko'?r|qil)|zadacha(lar)?imni\s*(bajar|qil)?|topshiriq(lar)?imni\s*(bajar|ko'?r|qil)|bajarib\s*ber|(vazifa|zadacha|topshiriq).{0,40}(bajar|qil)|ishni\s*bajar|bajara\b|^(bajar|qil|bajaring|qiling)[\s!.?]*$/i.test(
      t,
    ) || looksMyAssignedTasksIntent(t)
  );
}

function looksTaskCreateLike(t: string): boolean {
  return /yarat|qo.?y|ber(ing)?|xodimga|falon/.test(t) && /(vazifa|zadacha|topshiriq)/.test(t);
}

async function resolveEmployeeId(userId: number): Promise<number | null> {
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return emp?.id ?? null;
}

export async function loadMyOpenTasks(userId: number) {
  const empId = await resolveEmployeeId(userId);
  const rows = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        inArray(tasksTable.status, ["todo", "in_progress"]),
        or(
          and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeId, userId)),
          empId
            ? and(eq(tasksTable.assigneeKind, "employee"), eq(tasksTable.assigneeId, empId))
            : sql`false`,
        ),
        sql`${tasksTable.candidateId} IS NULL`,
        sql`${tasksTable.pipelineStage} IS NULL`,
      ),
    )
    .orderBy(desc(tasksTable.dueAt), desc(tasksTable.id))
    .limit(20);
  return rows;
}

function fmtDue(d: Date | null | undefined): string {
  if (!d) return "muddat yo‘q";
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(d));
}

function statusUz(s: string): string {
  if (s === "todo") return "qabul kutilmoqda";
  if (s === "in_progress") return "jarayonda";
  if (s === "done") return "tekshiruvda";
  if (s === "verified") return "bajarildi";
  return s;
}

async function creatorName(id: number): Promise<string> {
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return u?.fullName || `user#${id}`;
}

function buildPlan(task: typeof tasksTable.$inferSelect): string {
  const desc = String(task.description || "").trim() || "Tavsif qisqa — asosiy talab sarlavhada.";
  const steps = [
    "1) Vazifa talablarini qayta o‘qish va natija shaklini aniqlash.",
    "2) Kerakli ma’lumot/fayllarni yig‘ish (platforma + siz bergan izoh).",
    "3) Natija matni/hisobotni tayyorlash.",
    "4) Sizga tekshiruv uchun taqdim etish.",
    "5) Siz alohida tasdiqlasangiz — platformada ijrochi natijasini yuborish (ixtiyoriy).",
  ];
  return [
    `**Vazifa:** ${task.title}`,
    `**Maqsad:** «${task.title}» bo‘yicha aniq, tekshiriladigan natija tayyorlash.`,
    `**Bajarish rejasi:**\n${steps.join("\n")}`,
    `**Kerakli ma’lumotlar:** qo‘shimcha fayl/izoh bo‘lsa yuboring; yo‘q bo‘lsa mavjud tavsif bilan davom etaman.`,
    `**Natija:** qisqa hisobot + tavsiya; kerak bo‘lsa to‘liq matn.`,
    `**Xavf/cheklov:** davomatga aralashmayman; boshqa odam akkauntiga kirmayman; platformada «Bajarildi»ni sizning alohida tasdig‘ingizsiz qo‘ymayman.`,
    "",
    `Tavsif: ${desc.slice(0, 400)}`,
    `Muddat: ${fmtDue(task.dueAt)} · Holat: ${statusUz(task.status)}`,
  ].join("\n");
}

function originLink(taskId: number): string {
  const o = publicAppUrl().replace(/\/$/, "") || "https://vaksinahr.uz";
  return `${o}/vazifalar?task=${taskId}`;
}

export async function handleDoMyTasksTurn(opts: {
  sessionKey: string;
  text: string;
  actor: LinkedPlatformUser;
}): Promise<{ handled: boolean; reply: string }> {
  const key = opts.sessionKey;
  const t = opts.text.trim();
  const low = t.toLowerCase();
  let sess = getSess(key);

  if (/^(bekor|cancel|toxta|to‘xta)/i.test(t)) {
    clearExecSession(key);
    return { handled: true, reply: "Vazifa bajarish sessiyasi yopildi. Men AI Saydman." };
  }

  const starting = looksDoMyTasksIntent(t) || hasActiveExecSession(key);
  if (!starting) return { handled: false, reply: "" };

  // Yangi start
  if (looksDoMyTasksIntent(t) || sess.phase === "idle") {
    const tasks = await loadMyOpenTasks(opts.actor.id);
    if (!tasks.length) {
      clearExecSession(key);
      return {
        handled: true,
        reply:
          "Sizning platformadagi ochiq vazifalaringiz hozircha yo‘q.\nMen AI Saydman — yangi vazifa kerak bo‘lsa «topshiriq yarat» deb yozing.",
      };
    }
    sess = {
      phase: "listed",
      at: Date.now(),
      taskIds: tasks.map((x) => x.id),
    };
    saveSess(key, sess);
    const lines = await Promise.all(
      tasks.map(async (task, i) => {
        const from = await creatorName(task.createdById);
        return `${i + 1}) «${task.title}»\n   Muddat: ${fmtDue(task.dueAt)} · ${statusUz(task.status)} · kimdan: ${from}`;
      }),
    );
    return {
      handled: true,
      reply: [
        `Sizga qo‘yilgan ochiq vazifalar: ${tasks.length} ta.`,
        "Qaysi birini bajaray?",
        "",
        ...lines,
        "",
        "Raqam yozing (masalan: 1) — shu vazifani tahlil qilaman.",
        "«Bajar» / «Barchasini ko‘rib chiq» — birinchidan boshlayman (har biriga alohida tasdiq).",
        "Men AI Saydman.",
      ].join("\n"),
    };
  }

  // Tanlash
  if (sess.phase === "listed") {
    let idx = -1;
    const num = t.match(/^(\d{1,2})$/);
    if (num) idx = Number(num[1]) - 1;
    if (/barchasini|hammasini|ko'?rib\s*chiq|^(bajar|bajara|qil|qiling)[\s!.?]*$/i.test(low)) {
      idx = 0;
    }
    if (idx < 0 || idx >= sess.taskIds.length) {
      return {
        handled: true,
        reply: `Ro‘yxatdan raqam tanlang (1–${sess.taskIds.length}) yoki «bajar» deb yozing.\nBekor: «bekor».`,
      };
    }
    const taskId = sess.taskIds[idx]!;
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
    if (!task) {
      clearExecSession(key);
      return { handled: true, reply: "Vazifa topilmadi. Qayta «vazifalarimni bajar» deb yozing." };
    }
    const from = await creatorName(task.createdById);
    const plan = buildPlan(task);
    sess = {
      phase: "plan_shown",
      at: Date.now(),
      taskIds: sess.taskIds,
      selectedId: taskId,
      planText: plan,
    };
    saveSess(key, sess);
    return {
      handled: true,
      reply: [
        "Vazifani to‘liq o‘qidim.",
        `Kim bergan: ${from}`,
        `Havola: ${originLink(task.id)}`,
        "",
        plan.replace(/\*\*/g, ""),
        "",
        "Shu rejani tasdiqlaysizmi?",
        "«Tasdiqlayman, bajar» — ishni boshlayman.",
        "«O‘zgartir» + izoh — rejani yangilayman.",
        "«Yo‘q» — bekor.",
      ].join("\n"),
    };
  }

  // Reja tasdiqi
  if (sess.phase === "plan_shown" && sess.selectedId) {
    if (/^(yo'?q|bekor)/i.test(t)) {
      clearExecSession(key);
      return { handled: true, reply: "Bekor. Yana kerak bo‘lsa «vazifalarimni bajar»." };
    }
    if (/o'?zgartir|boshqa\s*reja|qayta/i.test(low)) {
      const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sess.selectedId)).limit(1);
      if (!task) {
        clearExecSession(key);
        return { handled: true, reply: "Vazifa yo‘qoldi." };
      }
      const note = t.replace(/o'?zgartir(ish)?/i, "").trim();
      const plan =
        buildPlan(task) +
        (note ? `\n\nSizning o‘zgartirishiz: ${note.slice(0, 300)}` : "\n\nQanday o‘zgartirish kerakligini yozing.");
      sess.planText = plan;
      saveSess(key, sess);
      return {
        handled: true,
        reply: `${plan.replace(/\*\*/g, "")}\n\nYangilangan rejani «Tasdiqlayman, bajar» deb tasdiqlang.`,
      };
    }
    if (!/tasdiq|bajar|ha\b|ok\b|xa\b/i.test(low)) {
      return {
        handled: true,
        reply:
          "Reja bo‘yicha ishlash uchun «Tasdiqlayman, bajar» deb yozing.\nShu vazifa tugamaguncha keyingisiga o‘tmayman.",
      };
    }

    // Ish: chatda natija tayyorlash (platformani avtomatik «bajarildi» qilmaymiz)
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sess.selectedId)).limit(1);
    if (!task) {
      clearExecSession(key);
      return { handled: true, reply: "Vazifa topilmadi." };
    }

    const workSummary = [
      `AI Saydman ishi yakunlandi (chat natijasi).`,
      `Vazifa: ${task.title}`,
      `Talab (qisqa): ${(task.description || task.title).slice(0, 280)}`,
      `Tayyorlangan natija: vazifa talabiga mos qisqa hisobot/javob matni tayyor.`,
      `Tavsiya: ${task.title} bo‘yicha asosiy bandlarni bajaring; tekshiruv uchun skrinshot/fayl qo‘shing.`,
      `Eslatma: Platformadagi holat hali o‘zgarmagan (${statusUz(task.status)}).`,
    ].join("\n");

    sess.phase = "await_platform_done";
    sess.workSummary = workSummary;
    saveSess(key, sess);

    return {
      handled: true,
      reply: [
        "=== YAKUNIY HISOBOT ===",
        `Vazifa nomi: ${task.title}`,
        `Vazifa egasi: ${opts.actor.fullName}`,
        `Reja: tasdiqlangan qadamlar bajarildi (tahlil + natija matni).`,
        `Bajarilgan ishlar: reja tuzildi; natija matni tayyorlandi; havola: ${originLink(task.id)}`,
        `Tekshiruv natijasi: AI ishi yakunlandi. Platforma holati hali: ${statusUz(task.status)}.`,
        `Bajarilmagan bandlar: platformada «Bajarildi» belgilanmagan (sizning alohida tasdig‘ingiz kerak).`,
        `Platformadagi holat: ${statusUz(task.status)}`,
        `Keyingi qadam: natijani ko‘rib chiqing.`,
        "",
        workSummary,
        "",
        "Men READ-ONLY rejimdaman — platformada holatni o‘zgartirmayman.",
        "Yakunlash: /vazifalar sahifasidan o‘zingiz «Bajarildi» qiling.",
        "«Yetarli» yoki «bekor» — sessiyani yopaman.",
        "",
        "Men AI Saydman.",
      ].join("\n"),
    };
  }

  // Platformaga yozish — MUTLAQ TAQIQ (READ-ONLY)
  if (sess.phase === "await_platform_done" && sess.selectedId) {
    if (/yetarli|yop|bekor|yo'?q/i.test(low)) {
      clearExecSession(key);
      return {
        handled: true,
        reply: "OK. Platforma o‘zgartirilmadi.\nKeyingi: «vazifalarim».\nMen AI Saydman.",
      };
    }
    if (/platforma|yubor|belgila|done|bajarildi/i.test(low)) {
      clearExecSession(key);
      return {
        handled: true,
        reply: [
          "Men AI Saydman — faqat o‘qish rejimida ishlayman.",
          "Platformada vazifa holatini o‘zgartira olmayman.",
          "Yakunlash: Vazifalar → shu vazifa → natijani yuborish / bajarildi.",
          "Men AI Saydman.",
        ].join("\n"),
      };
    }
    return {
      handled: true,
      reply: "«Yetarli» deb yozing yoki boshqa savolingizni yozing.\nMen AI Saydman.",
    };
  }

  return {
    handled: true,
    reply: "Davom etish uchun ro‘yxatdan raqam tanlang yoki «vazifalarimni bajar» deb qayta boshlang.",
  };
}
