/**
 * «Men qo‘ygan topshiriqlar» — created_by_id bo‘yicha o‘qish.
 * Xodim nomi bilan filtr (ixtiyoriy). Har gapga «xodim belgilang» demaydi.
 */
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db, employeesTable, tasksTable, usersTable } from "@workspace/db";
import { publicAppUrl } from "./telegram";
import { logger } from "./logger";
import type { LinkedPlatformUser } from "./personal-bot-context";

type CreatedSess = {
  at: number;
  awaitingName?: boolean;
  lastQuery?: string;
};

const sessions = new Map<string, CreatedSess>();
const TTL = 12 * 60_000;

function getSess(key: string): CreatedSess {
  const cur = sessions.get(key);
  if (cur && Date.now() - cur.at < TTL) return cur;
  const s: CreatedSess = { at: Date.now() };
  sessions.set(key, s);
  return s;
}

function saveSess(key: string, s: CreatedSess) {
  sessions.set(key, { ...s, at: Date.now() });
}

export function clearCreatedTasksSession(key: string) {
  sessions.delete(key);
}

export function hasActiveCreatedTasksSession(key: string): boolean {
  const s = sessions.get(key);
  return Boolean(s && Date.now() - s.at < TTL && s.awaitingName);
}

/** Men boshqalarga qo‘ygan / bergan topshiriqlar */
export function looksTasksICreatedIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  return /men\s*(qo.?ygan|bergan)|boshqalarga\s*(qo.?y|ber)|men\s*bergan\s*(topshiriq|vazifa|zadacha)|(topshiriq|vazifa|zadacha).{0,20}(qo.?ygan|bergan)im|qo.?ygan\s*(topshiriq|vazifa|zadacha)|bergan\s*(topshiriq|vazifa|zadacha).*bor|men\s*yozgan\s*(topshiriq|vazifa)/.test(
    t,
  );
}

/** Faqat aniq ism / «ismgachi» — umumiy gaplarni ushlamaydi */
export function looksAssigneeNameProbe(text: string): boolean {
  const t = text.trim().replace(/[‘’ʻ`]/g, "'");
  if (t.length < 3 || t.length > 60) return false;
  if (
    /^(salom|assalom|ha|yo'?q|bekor|ok|bajar|qil|davomat|oylik|kirish|yordam)/i.test(t)
  ) {
    return false;
  }
  if (/\S+gachi\b/i.test(t) && t.split(/\s+/).length <= 3) return true;
  // To‘liq ism-familiya (2–3 so‘z, faqat harf)
  return /^[A-Za-zА-Яа-яЎўҚқҒғҲҳ''`ʻ\-]{2,}(\s+[A-Za-zА-Яа-яЎўҚқҒғҲҳ''`ʻ\-]{2,}){1,2}$/u.test(
    t,
  );
}

function looksUnrelatedToName(text: string): boolean {
  const t = text.toLowerCase();
  return /davomat|oylik|jarima|keldim|ketdim|kirish|parol|qr|majburiyat|salom|yordam|platform|skrin|face\s*id|smena|pdf/.test(
    t,
  );
}

function extractNameHint(text: string): string {
  let t = text.trim().replace(/[‘’ʻ`]/g, "'");
  t = t
    .replace(/\b(gachi|chi|ga|uchun|haqida|bo'?yicha|topshiriq|vazifa|zadacha|qani|bor\s*mi)\b/gi, " ")
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

function statusUz(s: string): string {
  if (s === "todo") return "qabul kutilmoqda";
  if (s === "in_progress") return "jarayonda";
  if (s === "done") return "tekshiruvda";
  if (s === "verified") return "bajarildi";
  if (s === "cancelled") return "bekor";
  return s;
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

function taskLink(id: number): string {
  const o = publicAppUrl().replace(/\/$/, "") || "https://vaksinahr.uz";
  return `${o}/vazifalar?task=${id}`;
}

async function resolveAssigneeLabel(kind: string, id: number): Promise<string> {
  if (kind === "employee") {
    const [e] = await db
      .select({ fullName: employeesTable.fullName, position: employeesTable.position })
      .from(employeesTable)
      .where(eq(employeesTable.id, id))
      .limit(1);
    if (e) return `${e.fullName}${e.position ? ` (${e.position})` : ""}`;
  } else {
    const [u] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (u?.fullName) return u.fullName;
  }
  return `#${id}`;
}

async function findEmployeesByName(fullName: string) {
  const q = fullName.trim().replace(/\s+/g, " ");
  if (!q) return [];
  const parts = q.split(" ").filter((p) => p.length >= 2);
  const like = `%${q}%`;
  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      userId: employeesTable.userId,
    })
    .from(employeesTable)
    .where(
      and(
        or(
          ilike(employeesTable.fullName, like),
          ...(parts.length ? parts.map((p) => ilike(employeesTable.fullName, `%${p}%`)) : []),
        ),
        ne(employeesTable.employmentStatus, "dismissed"),
        ne(employeesTable.employmentStatus, "closed"),
      ),
    )
    .limit(8);
}

type TaskRow = typeof tasksTable.$inferSelect;

async function loadCreatedOpenTasks(creatorId: number, assigneeEmployeeIds?: number[]) {
  const conds = [
    eq(tasksTable.createdById, creatorId),
    inArray(tasksTable.status, ["todo", "in_progress", "done"]),
    sql`${tasksTable.candidateId} IS NULL`,
    sql`${tasksTable.pipelineStage} IS NULL`,
    sql`${tasksTable.title} !~* '^[0-9]+-qadam'`,
    sql`NOT (${tasksTable.assigneeKind} = 'user' AND ${tasksTable.assigneeId} = ${creatorId})`,
  ];

  if (assigneeEmployeeIds?.length) {
    const emps = await db
      .select({ id: employeesTable.id, userId: employeesTable.userId })
      .from(employeesTable)
      .where(inArray(employeesTable.id, assigneeEmployeeIds));
    const userIds = emps
      .map((e) => e.userId)
      .filter((id): id is number => id != null && Number.isFinite(id));
    conds.push(
      or(
        and(eq(tasksTable.assigneeKind, "employee"), inArray(tasksTable.assigneeId, assigneeEmployeeIds)),
        userIds.length
          ? and(eq(tasksTable.assigneeKind, "user"), inArray(tasksTable.assigneeId, userIds))
          : sql`false`,
      )!,
    );
  }

  return db
    .select()
    .from(tasksTable)
    .where(and(...conds))
    .orderBy(desc(tasksTable.id))
    .limit(25);
}

async function loadOpenTasksForEmployees(empIds: number[]) {
  const emps = await db
    .select({ id: employeesTable.id, userId: employeesTable.userId })
    .from(employeesTable)
    .where(inArray(employeesTable.id, empIds));
  const userIds = emps
    .map((e) => e.userId)
    .filter((id): id is number => id != null && Number.isFinite(id));

  return db
    .select()
    .from(tasksTable)
    .where(
      and(
        inArray(tasksTable.status, ["todo", "in_progress", "done"]),
        sql`${tasksTable.candidateId} IS NULL`,
        sql`${tasksTable.pipelineStage} IS NULL`,
        or(
          and(eq(tasksTable.assigneeKind, "employee"), inArray(tasksTable.assigneeId, empIds)),
          userIds.length
            ? and(eq(tasksTable.assigneeKind, "user"), inArray(tasksTable.assigneeId, userIds))
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(tasksTable.id))
    .limit(25);
}

async function formatTaskLines(tasks: TaskRow[]): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const who = await resolveAssigneeLabel(t.assigneeKind, t.assigneeId);
    lines.push(
      `${i + 1}) #${t.id} «${t.title.slice(0, 100)}»\n   → ${who}\n   ${statusUz(t.status)} · muddat ${fmtDue(t.dueAt)}\n   ${taskLink(t.id)}`,
    );
  }
  return lines;
}

export async function handleCreatedTasksTurn(opts: {
  sessionKey: string;
  text: string;
  actor: LinkedPlatformUser;
}): Promise<{ handled: boolean; reply: string }> {
  const key = opts.sessionKey;
  const raw = opts.text.trim();
  const sess = getSess(key);

  if (/^(bekor|cancel)$/i.test(raw)) {
    clearCreatedTasksSession(key);
    return { handled: true, reply: "OK, bekor.\nMen AI Saydman." };
  }

  // Sessiya ochiq, lekin boshqa mavzu — qo‘yib yuboramiz (xodim so‘ramaymiz)
  if (sess.awaitingName && looksUnrelatedToName(raw) && !looksAssigneeNameProbe(raw)) {
    clearCreatedTasksSession(key);
    return { handled: false, reply: "" };
  }

  const startList = looksTasksICreatedIntent(raw);
  const nameProbe = looksAssigneeNameProbe(raw);
  const nameHint = extractNameHint(raw);

  // 1) Ro‘yxat — darhol chiqaramiz, xodim so‘ramaymiz
  if (startList && !nameProbe) {
    try {
      const tasks = await loadCreatedOpenTasks(opts.actor.id);
      if (!tasks.length) {
        clearCreatedTasksSession(key);
        return {
          handled: true,
          reply: [
            "Hozircha siz boshqalarga qo‘ygan ochiq topshiriq yo‘q.",
            "Yangi: «topshiriq yarat». Aniq xodim: «Nuraliyev Nurislom».",
            "Men AI Saydman.",
          ].join("\n"),
        };
      }
      const lines = await formatTaskLines(tasks);
      // Filtrlash ixtiyoriy — majburiy emas
      saveSess(key, { awaitingName: true, lastQuery: "all" });
      return {
        handled: true,
        reply: [
          `Siz qo‘ygan ochiq topshiriqlar: ${tasks.length} ta.`,
          "",
          ...lines,
          "",
          "Bitta xodim kerak bo‘lsa ismini yozing. Boshqa savol bo‘lsa shunchaki yozing.",
          "Men AI Saydman.",
        ].join("\n"),
      };
    } catch (err) {
      logger.warn({ err }, "bot-task-created: list");
      return { handled: true, reply: "Topshiriqlarni o‘qib bo‘lmadi. Qayta yozing.\nMen AI Saydman." };
    }
  }

  // 2) Ism / nurislomgachi — faqat aniq probe yoki filtr sessiyasi
  if ((nameProbe || (sess.awaitingName && nameHint.length >= 3)) && nameHint.length >= 3) {
    // Agar awaiting, lekin gap ismga o‘xshamasa — chiqamiz
    if (sess.awaitingName && !nameProbe && looksUnrelatedToName(raw)) {
      clearCreatedTasksSession(key);
      return { handled: false, reply: "" };
    }
    try {
      const found = await findEmployeesByName(nameHint);
      if (!found.length) {
        if (!sess.awaitingName && !startList) {
          return { handled: false, reply: "" };
        }
        return {
          handled: true,
          reply: `«${nameHint}» topilmadi. To‘liq ism yozing yoki boshqa savol bering.\nMen AI Saydman.`,
        };
      }
      if (found.length > 1 && nameHint.split(/\s+/).length < 2) {
        return {
          handled: true,
          reply: [
            `Bir nechta xodim («${nameHint}»):`,
            ...found.map((f, i) => `${i + 1}) ${f.fullName} — ${f.position || "—"}`),
            "To‘liq ism yozing.",
            "Men AI Saydman.",
          ].join("\n"),
        };
      }

      const empIds = found.map((f) => f.id);
      let tasks = await loadCreatedOpenTasks(opts.actor.id, empIds);
      if (
        !tasks.length &&
        ["admin", "hr", "manager", "mudir", "coordinator"].includes(String(opts.actor.role))
      ) {
        tasks = await loadOpenTasksForEmployees(empIds);
      }

      clearCreatedTasksSession(key);
      const label = found.length === 1 ? found[0]!.fullName : nameHint;
      if (!tasks.length) {
        return {
          handled: true,
          reply: `«${label}» ga ochiq topshiriq yo‘q.\nMen AI Saydman.`,
        };
      }
      const lines = await formatTaskLines(tasks);
      const mine = tasks.filter((t) => t.createdById === opts.actor.id).length;
      return {
        handled: true,
        reply: [
          `«${label}»: ${tasks.length} ta ochiq` + (mine ? ` (siz qo‘ygani: ${mine})` : "") + ".",
          "",
          ...lines,
          "",
          "Men AI Saydman.",
        ].join("\n"),
      };
    } catch (err) {
      logger.warn({ err }, "bot-task-created: by name");
      return { handled: true, reply: "Qidiruvda xato.\nMen AI Saydman." };
    }
  }

  // Sessiya bor, lekin ism emas — boshqa oqimga o‘tkazamiz
  if (sess.awaitingName) {
    clearCreatedTasksSession(key);
  }
  return { handled: false, reply: "" };
}
