/**
 * Intizom: davomat jarimalari bo‘yicha eskalatsiya.
 * 3-martadan boshlab har 4 soatda (DIGEST_HOURS) adminga umumiy, har bir
 * koordinatorga faqat o‘z xodimlari bo‘yicha PDF boradi; 5-marta va undan keyin
 * xodim o‘sha kuni tizimga kira olmaydi (admin/HR ochib bera oladi).
 */
import { eq, inArray } from "drizzle-orm";
import { db, pool, notificationsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { loadJarimaSnapshot } from "./kpi-payroll";
import { coordinatorNamesFor, coordinatorsFor, type CoordHit } from "./davomat-shift-report";
import { isTelegramConfigured, sendDocument } from "./telegram";
import { renderDisciplinePdf } from "./discipline-pdf";
import { logLetterError, syncExplanationLetters } from "./explanation-letter";
import { FINAL_STRIKE, JARIMA_RULE, strikePenalty } from "./attendance-jarima";
import { activeLockFor, invalidateLockCache, LOCK_MESSAGE, todayTashkent, type DisciplineLock } from "./discipline-lock";
import { isJarimaEnabled } from "./jarima-switch";

export { activeLockFor, LOCK_MESSAGE, todayTashkent };
export const ESCALATE_FROM = 3;
export const LOCK_FROM = 5;

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

export function kindLabel(kind: string): string {
  return kind === "late" ? "Kech keldi" : "Kelmadi";
}

export function strikeRule(n: number): string {
  if (n <= 1) return "Ogohlantirish (tushuntirish xati)";
  if (n <= 3) return "1 kunlik ish haqining 30%";
  if (n === 4) return "1 kunlik ish haqining 100%";
  if (n < FINAL_STRIKE) return "1 oylik ish haqining 50% · platforma bloki";
  return "1 oylik ish haqining 50% · oxirgi ogohlantirish, ishdan bo‘shatishga rozilik";
}

export async function listTodayLocks() {
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, l.lock_day, l.strike_n, l.event_date, l.kind, l.created_at,
            l.cleared_at, l.cleared_by_name, u.full_name, e.position, e.branch
       FROM discipline_locks l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN LATERAL (
         SELECT position, branch FROM discipline_events
          WHERE user_id = l.user_id AND month = l.month
          ORDER BY n DESC LIMIT 1
       ) e ON TRUE
      WHERE l.lock_day = $1
      ORDER BY l.created_at DESC`,
    [todayTashkent()],
  );
  return rows.map((r) => ({
    id: r.id as number,
    userId: r.user_id as number,
    fullName: (r.full_name as string) || "—",
    position: (r.position as string) || "",
    branch: (r.branch as string) || "",
    strikeN: r.strike_n as number,
    eventDate: r.event_date as string,
    kind: r.kind as string,
    createdAt: r.created_at as string,
    clearedAt: (r.cleared_at as string) || null,
    clearedByName: (r.cleared_by_name as string) || null,
  }));
}

export type TodayLock = Awaited<ReturnType<typeof listTodayLocks>>[number];

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

function weekdayOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : UZ_WEEKDAYS[d.getUTCDay()]!;
}

function penaltyOf(n: number): string {
  const base = strikePenalty(n);
  return n >= LOCK_FROM ? `${base} · shu kuni platforma yopiladi` : base.charAt(0).toUpperCase() + base.slice(1);
}

export type LockDetailsEvent = {
  n: number;
  date: string;
  weekday: string;
  kind: "late" | "absent";
  kindLabel: string;
  checkIn: string | null;
  branch: string;
  shift: string;
  penalty: string;
  trigger: boolean;
};

/** Bloklangan xodimning o‘ziga — nega bloklangani: shu oydagi har bir buzilish va qoida */
export async function lockDetailsFor(userId: number) {
  const lock = await activeLockFor(userId);
  if (!lock) return null;
  return detailsOfLock(lock);
}

/** Admin/HR: istalgan blok (ochilgan bo‘lsa ham) asoslari */
export async function lockDetailsById(lockId: number) {
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, l.lock_day, l.strike_n, l.event_date, l.kind, l.created_at,
            l.cleared_at, l.cleared_by_name, u.full_name
       FROM discipline_locks l
       JOIN users u ON u.id = l.user_id
      WHERE l.id = $1`,
    [lockId],
  );
  const r = rows[0];
  if (!r) return null;
  const details = await detailsOfLock({
    id: r.id,
    userId: r.user_id,
    lockDay: r.lock_day,
    strikeN: r.strike_n,
    eventDate: r.event_date,
    kind: r.kind,
  });
  const { rows: info } = await pool.query(
    `SELECT position, branch, shift, coordinator FROM discipline_events
      WHERE user_id = $1 AND month = $2 ORDER BY n DESC LIMIT 1`,
    [r.user_id, details.month],
  );
  return {
    ...details,
    id: r.id as number,
    userId: r.user_id as number,
    fullName: (r.full_name as string) || "—",
    position: (info[0]?.position as string) || "",
    branch: (info[0]?.branch as string) || "",
    shift: (info[0]?.shift as string) || "",
    coordinator: (info[0]?.coordinator as string) || "",
    createdAt: r.created_at as string,
    clearedAt: (r.cleared_at as string) || null,
    clearedByName: (r.cleared_by_name as string) || null,
  };
}

async function detailsOfLock(lock: DisciplineLock) {
  const month = (lock.eventDate || lock.lockDay).slice(0, 7);
  const { rows } = await pool.query(
    `SELECT employee_id, n, event_date, kind, branch, shift
       FROM discipline_events
      WHERE user_id = $1 AND month = $2
      ORDER BY n`,
    [lock.userId, month],
  );

  const checkIns = new Map<string, string>();
  const employeeId = rows.find((r) => r.employee_id != null)?.employee_id as number | undefined;
  const lateDates = rows.filter((r) => r.kind === "late").map((r) => r.event_date as string);
  if (employeeId && lateDates.length) {
    const { rows: recs } = await pool.query(
      `SELECT work_date, to_char(check_in_at AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') AS hm
         FROM attendance_records
        WHERE employee_id = $1 AND work_date = ANY($2::text[]) AND check_in_at IS NOT NULL
        ORDER BY check_in_at`,
      [employeeId, lateDates],
    );
    for (const r of recs) if (!checkIns.has(r.work_date)) checkIns.set(r.work_date, r.hm);
  }

  const events: LockDetailsEvent[] = rows.map((r) => {
    const kind = r.kind === "late" ? "late" : "absent";
    return {
      n: r.n as number,
      date: r.event_date as string,
      weekday: weekdayOf(r.event_date),
      kind,
      kindLabel: kindLabel(kind),
      checkIn: kind === "late" ? checkIns.get(r.event_date) ?? null : null,
      branch: (r.branch as string) || "",
      shift: (r.shift as string) || "",
      penalty: penaltyOf(r.n),
      trigger: r.n === lock.strikeN,
    };
  });
  const [y, m] = month.split("-");
  return {
    day: lock.lockDay,
    month,
    monthLabel: `${y}-yil ${UZ_MONTHS[Number(m) - 1] ?? m}`,
    strikeN: lock.strikeN,
    lockFrom: LOCK_FROM,
    triggerDate: lock.eventDate,
    triggerKind: lock.kind === "late" ? "late" : "absent",
    late: events.filter((e) => e.kind === "late").length,
    absent: events.filter((e) => e.kind === "absent").length,
    events,
    rules: [
      ...JARIMA_RULE,
      "Har bir buzilish bo‘yicha tushuntirish xati yozib imzolanmaguncha keyingi davomat belgilanmaydi",
      `${LOCK_FROM}-marta va undan keyin — buzilish qayd etilgan kuni platforma to‘liq yopiladi`,
    ],
  };
}

export async function clearLock(lockId: number, actorId: number): Promise<boolean> {
  const [actor] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, actorId));
  const { rows } = await pool.query(
    `UPDATE discipline_locks SET cleared_at = NOW(), cleared_by = $2, cleared_by_name = $3
      WHERE id = $1 AND cleared_at IS NULL RETURNING user_id`,
    [lockId, actorId, actor?.fullName || "Admin"],
  );
  if (!rows[0]) return false;
  invalidateLockCache(rows[0].user_id);
  return true;
}

export type DisciplineEventRow = {
  month: string;
  n: number;
  date: string;
  kind: string;
  amount: number;
  branch: string;
};

export type DisciplinePerson = {
  userId: number;
  employeeId: number | null;
  fullName: string;
  position: string;
  branch: string;
  shift: string;
  coordinator: string;
  strikes: number;
  monthAmount: number;
  events: DisciplineEventRow[];
  history: DisciplineEventRow[];
  locks: Array<{ day: string; strikeN: number; cleared: boolean; clearedBy: string | null }>;
};

export type DisciplineReport = {
  month: string;
  generatedAt: Date;
  people: DisciplinePerson[];
};

/** Shu oyda kamida 3 marta jarima olganlar — to‘liq tarix bilan */
export async function buildDisciplineReport(month: string): Promise<DisciplineReport> {
  const { rows: risk } = await pool.query(
    `SELECT DISTINCT user_id FROM discipline_events WHERE month = $1 AND n >= $2`,
    [month, ESCALATE_FROM],
  );
  const ids = risk.map((r) => r.user_id as number);
  if (!ids.length) return { month, generatedAt: new Date(), people: [] };

  const { rows: events } = await pool.query(
    `SELECT * FROM discipline_events WHERE user_id = ANY($1::int[]) ORDER BY user_id, month, n`,
    [ids],
  );
  const { rows: locks } = await pool.query(
    `SELECT user_id, lock_day, strike_n, cleared_at, cleared_by_name
       FROM discipline_locks WHERE user_id = ANY($1::int[]) ORDER BY lock_day`,
    [ids],
  );

  const people = new Map<number, DisciplinePerson>();
  for (const r of events) {
    const userId = r.user_id as number;
    let p = people.get(userId);
    if (!p) {
      p = {
        userId,
        employeeId: null,
        fullName: "",
        position: "",
        branch: "",
        shift: "",
        coordinator: "",
        strikes: 0,
        monthAmount: 0,
        events: [],
        history: [],
        locks: [],
      };
      people.set(userId, p);
    }
    const ev: DisciplineEventRow = {
      month: r.month,
      n: r.n,
      date: r.event_date,
      kind: r.kind,
      amount: Number(r.amount) || 0,
      branch: r.branch || "",
    };
    if (r.month === month) {
      p.events.push(ev);
      p.strikes = Math.max(p.strikes, ev.n);
      p.monthAmount += ev.amount;
      p.fullName = r.full_name || p.fullName;
      p.position = r.position || p.position;
      p.branch = r.branch || p.branch;
      p.shift = r.shift || p.shift;
      p.coordinator = r.coordinator || p.coordinator;
      p.employeeId = (r.employee_id as number | null) ?? p.employeeId;
    } else {
      p.history.push(ev);
    }
  }
  for (const r of locks) {
    people.get(r.user_id)?.locks.push({
      day: r.lock_day,
      strikeN: r.strike_n,
      cleared: !!r.cleared_at,
      clearedBy: r.cleared_by_name || null,
    });
  }
  const list = [...people.values()].sort(
    (a, b) => b.strikes - a.strikes || b.monthAmount - a.monthAmount || a.fullName.localeCompare(b.fullName, "uz"),
  );
  return { month, generatedAt: new Date(), people: list };
}

type Fresh = {
  id: number;
  userId: number;
  n: number;
  date: string;
  kind: string;
  fullName: string;
  branch: string;
  coordinator: string;
};

let scanning: Promise<void> | null = null;

export function runDisciplineScan(): Promise<void> {
  if (!scanning) {
    scanning = scanOnce()
      .catch((err) => logger.error({ err }, "Intizom tekshiruvi xato"))
      .finally(() => {
        scanning = null;
      });
  }
  return scanning;
}

let kickTimer: ReturnType<typeof setTimeout> | null = null;

/** Davomat belgilangandan keyin — bir necha soniyadan so‘ng qayta tekshirish */
export function kickDisciplineScan() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void runDisciplineScan();
  }, 15_000);
}

async function scanOnce(): Promise<void> {
  const today = todayTashkent();
  const yesterday = shiftYmd(today, -1);
  const month = today.slice(0, 7);
  const snap = await loadJarimaSnapshot(month);
  if (!snap?.active) return;

  const people = snap.people.filter((p) => p.strikes > 0);
  const coords = await coordinatorNamesFor(people.map((p) => p.employeeId));
  const { rows: existingRows } = await pool.query(
    `SELECT user_id, n, event_date, kind FROM discipline_events WHERE month = $1`,
    [month],
  );
  const existing = new Map(existingRows.map((r) => [`${r.user_id}:${r.n}`, `${r.event_date}|${r.kind}`]));

  const fresh: Fresh[] = [];
  for (const p of people) {
    const coordinator = coords.get(p.employeeId) || "";
    for (const ev of p.events) {
      const key = `${p.userId}:${ev.n}`;
      const changed = existing.get(key) !== `${ev.date}|${ev.kind}`;
      const { rows } = await pool.query(
        `INSERT INTO discipline_events
           (user_id, employee_id, month, n, event_date, kind, amount, full_name, position, branch, shift, coordinator)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_id, month, n) DO UPDATE SET
           employee_id = EXCLUDED.employee_id,
           event_date = EXCLUDED.event_date,
           kind = EXCLUDED.kind,
           amount = EXCLUDED.amount,
           full_name = EXCLUDED.full_name,
           position = EXCLUDED.position,
           branch = EXCLUDED.branch,
           shift = EXCLUDED.shift,
           coordinator = EXCLUDED.coordinator,
           notified_at = CASE WHEN $13 THEN NULL ELSE discipline_events.notified_at END
         RETURNING id`,
        [p.userId, p.employeeId, month, ev.n, ev.date, ev.kind, ev.amount, p.fullName, p.position, p.branch, p.shift, coordinator, changed],
      );
      if (changed && ev.n >= ESCALATE_FROM) {
        fresh.push({
          id: rows[0].id,
          userId: p.userId,
          n: ev.n,
          date: ev.date,
          kind: ev.kind,
          fullName: p.fullName,
          branch: p.branch,
          coordinator,
        });
      }
    }
    await pool.query(`DELETE FROM discipline_events WHERE user_id = $1 AND month = $2 AND n > $3`, [p.userId, month, p.strikes]);
  }
  await pool.query(`DELETE FROM discipline_events WHERE month = $1 AND NOT (user_id = ANY($2::int[]))`, [
    month,
    people.map((p) => p.userId),
  ]);
  await syncExplanationLetters(month, people, today).catch((err) => logLetterError(err, "sinxronlash"));

  const belowLock = snap.people.filter((p) => p.strikes < LOCK_FROM).map((p) => p.userId);
  const { rows: released } = await pool.query(
    `UPDATE discipline_locks SET cleared_at = NOW(), cleared_by_name = 'Jarima bekor qilindi'
      WHERE lock_day = $1 AND cleared_at IS NULL AND user_id = ANY($2::int[])
      RETURNING user_id`,
    [today, belowLock],
  );
  for (const r of released) invalidateLockCache(r.user_id);

  for (const f of fresh) {
    if (f.n < LOCK_FROM || f.date < yesterday) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO discipline_locks (user_id, lock_day, month, strike_n, event_date, kind)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, lock_day) DO NOTHING`,
      [f.userId, today, month, f.n, f.date, f.kind],
    );
    if (rowCount) invalidateLockCache(f.userId);
  }
}

/** Intizom hisoboti shu soatlarda (Toshkent vaqti) yuboriladi — har 4 soatda */
export const DIGEST_HOURS = [8, 12, 16, 20];

function tashkentHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", hour12: false }).format(d)) % 24;
}

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

function digestSlot(now = new Date()): { id: string; hour: number } | null {
  const hour = tashkentHour(now);
  const slot = [...DIGEST_HOURS].reverse().find((h) => h <= hour);
  return slot == null ? null : { id: `${todayTashkent()}T${hhmm(slot)}`, hour: slot };
}

function nextDigestLabel(hour: number): string {
  const next = DIGEST_HOURS.find((h) => h > hour);
  return next != null ? `bugun ${hhmm(next)}` : `ertaga ${hhmm(DIGEST_HOURS[0]!)}`;
}

/** Hisobotdagi koordinatorlarni joriy rahbarlik zanjiri bo‘yicha yangilaydi */
export async function attachLiveCoordinators(report: DisciplineReport): Promise<Map<number, CoordHit>> {
  const ids = report.people.map((p) => p.employeeId).filter((id): id is number => id != null);
  const hits = await coordinatorsFor(ids);
  for (const p of report.people) {
    const hit = p.employeeId != null ? hits.get(p.employeeId) : undefined;
    if (hit) p.coordinator = hit.name;
  }
  return hits;
}

let digesting: Promise<void> | null = null;

/** Joriy 4 soatlik slot uchun hisobot hali yuborilmagan bo‘lsa — yuboradi */
export function runDisciplineDigest(): Promise<void> {
  if (!digesting) {
    digesting = digestOnce()
      .catch((err) => logger.error({ err }, "Intizom hisoboti yuborilmadi"))
      .finally(() => {
        digesting = null;
      });
  }
  return digesting;
}

async function digestOnce(): Promise<void> {
  const slot = digestSlot();
  if (!slot || !(await isJarimaEnabled())) return;
  const { rowCount } = await pool.query(`INSERT INTO discipline_digests (slot) VALUES ($1) ON CONFLICT (slot) DO NOTHING`, [slot.id]);
  if (!rowCount) return;
  try {
    const stats = await sendDigest(slot.hour);
    await pool.query(`UPDATE discipline_digests SET people = $2, admins = $3, coordinators = $4 WHERE slot = $1`, [
      slot.id,
      stats.people,
      stats.admins,
      stats.coordinators,
    ]);
    logger.info({ slot: slot.id, ...stats }, "Intizom hisoboti yuborildi");
  } catch (err) {
    await pool.query(`DELETE FROM discipline_digests WHERE slot = $1`, [slot.id]).catch(() => undefined);
    throw err;
  }
}

function consequence(n: number, lockedToday: boolean): string {
  if (n >= FINAL_STRIKE) return `1 oylikning 50% jarima, oxirgi ogohlantirish${lockedToday ? ", bugun tizim bloklandi" : ""}`;
  if (n >= LOCK_FROM) return `1 oylikning 50% jarima${lockedToday ? ", bugun tizim bloklandi" : ""}`;
  return strikePenalty(n);
}

function lastEvent(p: DisciplinePerson): DisciplineEventRow | undefined {
  return [...p.events].sort((a, b) => b.n - a.n)[0];
}

/** Telegram caption 1024 belgidan oshmasin — ro‘yxat qismini qisqartiradi */
function buildCaption(head: string[], items: string[], tail: string[], limit = 1000): string {
  const join = (list: string[], rest: number) =>
    [...head, ...list, ...(rest > 0 ? [`… yana ${rest} ta (PDF da)`] : []), ...tail].join("\n");
  for (let n = items.length; n >= 0; n--) {
    const text = join(items.slice(0, n), items.length - n);
    if (text.length <= limit) return text;
  }
  return join([], items.length).slice(0, limit);
}

async function sendDigest(hour: number): Promise<{ people: number; admins: number; coordinators: number }> {
  const today = todayTashkent();
  const month = today.slice(0, 7);
  const report = await buildDisciplineReport(month);
  if (!report.people.length) return { people: 0, admins: 0, coordinators: 0 };

  const coordHits = await attachLiveCoordinators(report);
  const { rows: pendingRows } = await pool.query(
    `SELECT id, user_id FROM discipline_events WHERE month = $1 AND n >= $2 AND notified_at IS NULL`,
    [month, ESCALATE_FROM],
  );
  const freshUsers = new Set(pendingRows.map((r) => r.user_id as number));
  const { rows: lockRows } = await pool.query(
    `SELECT user_id FROM discipline_locks WHERE lock_day = $1 AND cleared_at IS NULL`,
    [today],
  );
  const lockedToday = new Set(lockRows.map((r) => r.user_id as number));

  const asOf = `${fmtYmd(today)}, ${hhmm(hour)} holatiga`;
  const nextLabel = nextDigestLabel(hour);
  const tg = isTelegramConfigured();

  const describe = (p: DisciplinePerson, withCoord: boolean) => {
    const ev = lastEvent(p);
    const what = ev ? `${kindLabel(ev.kind).toLowerCase()} ${fmtYmd(ev.date)}` : "";
    const place = [p.branch || "filial yo‘q", withCoord && p.coordinator ? `koord.: ${p.coordinator}` : ""].filter(Boolean).join(", ");
    return `${freshUsers.has(p.userId) ? "🆕 " : "• "}${p.fullName} (${place}) — ${p.strikes}-marta${what ? `, ${what}` : ""} — ${consequence(p.strikes, lockedToday.has(p.userId))}`;
  };

  // Koordinatorlar bo‘yicha guruhlash
  const groups = new Map<number, { hit: CoordHit; people: DisciplinePerson[] }>();
  const unassigned: DisciplinePerson[] = [];
  for (const p of report.people) {
    const hit = p.employeeId != null ? coordHits.get(p.employeeId) : undefined;
    if (!hit) {
      unassigned.push(p);
      continue;
    }
    const g = groups.get(hit.id) ?? { hit, people: [] };
    g.people.push(p);
    groups.set(hit.id, g);
  }

  const coordUserIds = [...groups.values()].map((g) => g.hit.userId).filter((id): id is number => id != null);
  const coordUsers = coordUserIds.length
    ? await db
        .select({ id: usersTable.id, status: usersTable.status, telegramId: usersTable.telegramId })
        .from(usersTable)
        .where(inArray(usersTable.id, coordUserIds))
    : [];
  const coordUserById = new Map(coordUsers.map((u) => [u.id, u]));

  let coordinatorsSent = 0;
  const noTelegram: string[] = [];
  for (const { hit, people } of groups.values()) {
    const user = hit.userId != null ? coordUserById.get(hit.userId) : undefined;
    if (!user || user.status !== "active") {
      noTelegram.push(hit.name);
      continue;
    }
    const freshCount = people.filter((p) => freshUsers.has(p.userId)).length;
    const caption = buildCaption(
      [
        "⚠️ Intizom hisoboti — sizning xodimlaringiz",
        asOf,
        "",
        `Hurmatli ${hit.name}! Sizga biriktirilgan ${people.length} nafar xodim shu oyda 3 va undan ko‘p marta davomat jarimasi oldi${freshCount ? ` (${freshCount} tasi yangi)` : ""}:`,
      ],
      people.map((p) => describe(p, false)),
      [
        "",
        "❗️ Har bir holat sababini bugunoq aniqlang, xodim bilan suhbat o‘tkazing va HR ga asosli ma’lumot bering.",
        "Agar bu holatlar bo‘yicha ma’lumotga ega bo‘lmasangiz — sizga ham jarima qo‘llaniladi.",
        "",
        `PDF da: har bir xodimning sanalari, sabablari, jarima summalari va oldingi tarixi. Keyingi yangilanish: ${nextLabel}.`,
      ],
    );
    await db.insert(notificationsTable).values({ userId: user.id, text: caption.slice(0, 2000), type: "discipline_alert" });
    const chatId = String(user.telegramId || hit.telegramId || "").trim();
    if (!chatId || !tg) {
      noTelegram.push(hit.name);
      continue;
    }
    try {
      const pdf = await renderDisciplinePdf({ month, generatedAt: report.generatedAt, people }, { coordinatorName: hit.name });
      await sendDocument(chatId, pdf, `intizom_${month}_${today}_${hhmm(hour).replace(":", "")}.pdf`, {
        mimeType: "application/pdf",
        caption,
      });
      coordinatorsSent += 1;
    } catch (err) {
      noTelegram.push(hit.name);
      logger.error({ err, coordinatorId: hit.id }, "Intizom PDF koordinatorga yuborilmadi");
    }
  }

  const admins = await db
    .select({ id: usersTable.id, telegramId: usersTable.telegramId, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const activeAdmins = admins.filter((a) => a.status === "active");

  const by = (pred: (p: DisciplinePerson) => boolean) => report.people.filter(pred).length;
  const total = report.people.reduce((s, p) => s + p.monthAmount, 0);
  const freshPeople = report.people.filter((p) => freshUsers.has(p.userId));
  const delivery = [
    `📨 Koordinatorlarga yuborildi: ${coordinatorsSent} ta`,
    ...(noTelegram.length
      ? [`Telegram ulanmagan: ${noTelegram.slice(0, 3).join(", ")}${noTelegram.length > 3 ? ` va yana ${noTelegram.length - 3} ta` : ""}`]
      : []),
    ...(unassigned.length ? [`Koordinator biriktirilmagan: ${unassigned.length} xodim`] : []),
  ];
  const adminCaption = buildCaption(
    [
      "📊 Intizom hisoboti — davomat jarimalari",
      asOf,
      "",
      `Shu oy 3+ marta: ${report.people.length} xodim (5+: ${by((p) => p.strikes >= 5)} · 4: ${by((p) => p.strikes === 4)} · 3: ${by((p) => p.strikes === 3)}) · jami ${Math.round(total).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} so‘m`,
      "",
      freshPeople.length ? `🆕 Oxirgi hisobotdan beri yangi holatlar (${freshPeople.length}):` : "Oxirgi hisobotdan beri yangi holat yo‘q — umumiy holat yangilandi.",
    ],
    freshPeople.map((p) => describe(p, true)),
    ["", ...delivery, "", `Keyingi yangilanish: ${nextLabel}.`],
  );

  for (const admin of activeAdmins) {
    await db.insert(notificationsTable).values({
      userId: admin.id,
      text: adminCaption.slice(0, 2000),
      type: "discipline_alert",
      linkUrl: "/oylik",
    });
  }

  let adminsSent = 0;
  const adminTargets = activeAdmins.filter((a) => String(a.telegramId || "").trim());
  if (adminTargets.length && tg) {
    const pdf = await renderDisciplinePdf(report);
    for (const admin of adminTargets) {
      try {
        await sendDocument(String(admin.telegramId), pdf, `intizom_${month}_${today}_${hhmm(hour).replace(":", "")}.pdf`, {
          mimeType: "application/pdf",
          caption: adminCaption,
        });
        adminsSent += 1;
      } catch (err) {
        logger.error({ err, adminId: admin.id }, "Intizom PDF admin ga yuborilmadi");
      }
    }
  }

  if (pendingRows.length) {
    await pool.query(`UPDATE discipline_events SET notified_at = NOW() WHERE id = ANY($1::int[])`, [pendingRows.map((r) => r.id)]);
  }
  return { people: report.people.length, admins: adminsSent, coordinators: coordinatorsSent };
}
