/**
 * Intizom: davomat jarimalari bo‘yicha eskalatsiya.
 * 3-martadan boshlab adminga yig‘ma PDF boradi; 5-marta va undan keyin
 * xodim o‘sha kuni tizimga kira olmaydi (admin/HR ochib bera oladi).
 */
import { eq } from "drizzle-orm";
import { db, pool, notificationsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { loadJarimaSnapshot } from "./kpi-payroll";
import { coordinatorNamesFor } from "./davomat-shift-report";
import { isTelegramConfigured, sendDocument } from "./telegram";
import { renderDisciplinePdf } from "./discipline-pdf";
import { activeLockFor, invalidateLockCache, LOCK_MESSAGE, todayTashkent } from "./discipline-lock";

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
  if (n <= 2) return "1 kunlik ish haqining 30%";
  if (n === 3) return "1 kunlik ish haqining 100%";
  if (n === 4) return "1 oylik ish haqining 50%";
  return "1 oylik ish haqining 50% · ishdan bo‘shatish masalasi";
}

export async function listTodayLocks() {
  const { rows } = await pool.query(
    `SELECT l.id, l.user_id, l.lock_day, l.strike_n, l.event_date, l.kind, l.created_at,
            l.cleared_at, l.cleared_by_name, u.full_name
       FROM discipline_locks l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.lock_day = $1
      ORDER BY l.created_at DESC`,
    [todayTashkent()],
  );
  return rows.map((r) => ({
    id: r.id as number,
    userId: r.user_id as number,
    fullName: (r.full_name as string) || "—",
    strikeN: r.strike_n as number,
    eventDate: r.event_date as string,
    kind: r.kind as string,
    createdAt: r.created_at as string,
    clearedAt: (r.cleared_at as string) || null,
    clearedByName: (r.cleared_by_name as string) || null,
  }));
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

  const belowLock = snap.people.filter((p) => p.strikes < LOCK_FROM).map((p) => p.userId);
  const { rows: released } = await pool.query(
    `UPDATE discipline_locks SET cleared_at = NOW(), cleared_by_name = 'Jarima bekor qilindi'
      WHERE lock_day = $1 AND cleared_at IS NULL AND user_id = ANY($2::int[])
      RETURNING user_id`,
    [today, belowLock],
  );
  for (const r of released) invalidateLockCache(r.user_id);

  const lockedNow: Fresh[] = [];
  for (const f of fresh) {
    if (f.n < LOCK_FROM || f.date < yesterday) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO discipline_locks (user_id, lock_day, month, strike_n, event_date, kind)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, lock_day) DO NOTHING`,
      [f.userId, today, month, f.n, f.date, f.kind],
    );
    if (rowCount) {
      invalidateLockCache(f.userId);
      lockedNow.push(f);
    }
  }

  const { rows: pending } = await pool.query(
    `SELECT id, user_id, n, event_date, kind, full_name, branch, coordinator
       FROM discipline_events
      WHERE month = $1 AND n >= $2 AND notified_at IS NULL
      ORDER BY n DESC, event_date DESC`,
    [month, ESCALATE_FROM],
  );
  if (!pending.length) return;

  const sent = await notifyAdmins(month, pending, lockedNow, yesterday);
  if (sent) {
    await pool.query(`UPDATE discipline_events SET notified_at = NOW() WHERE id = ANY($1::int[])`, [pending.map((r) => r.id)]);
  }
}

async function notifyAdmins(
  month: string,
  pending: Array<Record<string, any>>,
  lockedNow: Fresh[],
  recentFrom: string,
): Promise<boolean> {
  const admins = await db
    .select({ id: usersTable.id, telegramId: usersTable.telegramId, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const active = admins.filter((a) => a.status === "active");
  if (!active.length) return true;

  const recent = pending.filter((r) => r.event_date >= recentFrom);
  const older = pending.length - recent.length;
  const lockedIds = new Set(lockedNow.map((l) => l.userId));
  const line = (r: Record<string, any>) => {
    const tail =
      r.n >= LOCK_FROM
        ? lockedIds.has(r.user_id)
          ? " — bugun tizim bloklandi, ishdan bo‘shatish masalasi"
          : " — ishdan bo‘shatish masalasi"
        : r.n === 4
          ? " — 1 oylikning 50% jarima"
          : " — 1 kunlik ish haqining 100% jarima";
    return `• ${r.full_name} (${r.branch || "filial yo‘q"}${r.coordinator ? `, koord.: ${r.coordinator}` : ""}) — ${r.n}-marta, ${kindLabel(r.kind).toLowerCase()}, ${fmtYmd(r.event_date)}${tail}`;
  };

  const caption = [
    "⚠️ Intizom ogohlantirishi — davomat jarimalari",
    "",
    ...(recent.length ? recent.slice(0, 8).map(line) : ["Yangi holatlar yo‘q, umumiy holat yangilandi."]),
    ...(recent.length > 8 ? [`… yana ${recent.length - 8} ta`] : []),
    ...(older > 0 ? ["", `Avvalgi kunlardagi ${older} ta holat ham hisobotga qo‘shildi.`] : []),
    "",
    "PDF da: shu oyda 3 va undan ko‘p marta jarima olgan barcha xodimlar — filial, koordinator, sana, summa va oldingi tarix bilan.",
  ].join("\n");

  for (const admin of active) {
    await db.insert(notificationsTable).values({
      userId: admin.id,
      text: caption.slice(0, 2000),
      type: "discipline_alert",
      linkUrl: "/oylik",
    });
  }

  const targets = active.filter((a) => String(a.telegramId || "").trim());
  if (!targets.length || !isTelegramConfigured()) return true;

  const report = await buildDisciplineReport(month);
  const pdf = await renderDisciplinePdf(report);
  const file = `intizom_${month}_${todayTashkent()}.pdf`;
  let ok = false;
  for (const admin of targets) {
    try {
      await sendDocument(String(admin.telegramId), pdf, file, {
        mimeType: "application/pdf",
        caption: caption.slice(0, 1000),
      });
      ok = true;
    } catch (err) {
      logger.error({ err, adminId: admin.id }, "Intizom PDF admin ga yuborilmadi");
    }
  }
  return ok;
}
