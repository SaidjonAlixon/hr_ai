/**
 * «Smena va filial» bo‘limi: koordinatorlarga alohida ruxsatlar va o‘zgarishlar jurnali.
 * Admin / HR — to‘liq; koordinator — faqat admin bergan ruxsat (rotatsiya va/yoki smena) va doira bo‘yicha.
 */
import { pool } from "@workspace/db";
import { canManageSmenaFilial } from "./roles";
import { logger } from "./logger";
import { scriptIncludes } from "./script-search";

export type SmenaScope = "own" | "all";

export type CoordSmenaAccess = {
  userId: number;
  canRotate: boolean;
  canShift: boolean;
  scope: SmenaScope;
  grantedById: number | null;
  grantedByName: string | null;
  updatedAt: string;
};

export type SmenaActorAccess = {
  full: boolean;
  canRotate: boolean;
  canShift: boolean;
  scope: SmenaScope;
  any: boolean;
};

export type SmenaLogAction =
  | "rotation_create"
  | "rotation_cancel"
  | "slot_shift_change"
  | "shift_change"
  | "shift_override"
  | "legacy_assign"
  | "legacy_day_rotation"
  | "legacy_day_rotation_cancel"
  | "perm_change";

export type SmenaLogEntry = {
  action: SmenaLogAction;
  actor: { id: number | null; name: string | null; role: string | null };
  employee?: { id: number; name: string; orgRole: string | null } | null;
  fromBranch?: { id: number | null; label: string | null } | null;
  toBranch?: { id: number | null; label: string | null } | null;
  fromShift?: string | null;
  toShift?: string | null;
  mode?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  weekdays?: number[] | null;
  workDates?: string[] | null;
  note?: string | null;
  summary: string;
  slotId?: number | null;
  targetUserId?: number | null;
  ip?: string | null;
};

let ready: Promise<void> | null = null;

export function ensureSmenaAccessSchema(): Promise<void> {
  ready ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS smena_coord_access (
        user_id INT PRIMARY KEY,
        can_rotate BOOLEAN NOT NULL DEFAULT FALSE,
        can_shift BOOLEAN NOT NULL DEFAULT FALSE,
        scope TEXT NOT NULL DEFAULT 'own',
        granted_by INT,
        granted_by_name TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS smena_change_log (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        action TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'live',
        actor_user_id INT,
        actor_name TEXT,
        actor_role TEXT,
        employee_id INT,
        employee_name TEXT,
        employee_org_role TEXT,
        from_branch_id INT,
        from_branch_label TEXT,
        to_branch_id INT,
        to_branch_label TEXT,
        from_shift TEXT,
        to_shift TEXT,
        mode TEXT,
        valid_from TEXT,
        valid_to TEXT,
        weekdays JSONB,
        work_dates JSONB,
        note TEXT,
        summary TEXT NOT NULL DEFAULT '',
        slot_id INT,
        target_user_id INT,
        ip TEXT
      );
      CREATE INDEX IF NOT EXISTS smena_change_log_actor_idx ON smena_change_log (actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS smena_change_log_emp_idx ON smena_change_log (employee_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS smena_change_log_created_idx ON smena_change_log (created_at DESC);
      CREATE TABLE IF NOT EXISTS smena_meta (key TEXT PRIMARY KEY, done_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    `);
    await backfillLegacySlots().catch((err) => logger.warn({ err }, "smena_change_log backfill"));
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** Jurnal paydo bo‘lishidan oldingi rotatsiyalar — «qayerdan» noma’lum, qolgani slotdan. Faqat bir marta. */
async function backfillLegacySlots(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mark = await client.query(
      `INSERT INTO smena_meta (key) VALUES ('legacy_backfill') ON CONFLICT (key) DO NOTHING RETURNING key`,
    );
    if (!mark.rowCount) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(`
    INSERT INTO smena_change_log (
      created_at, action, source, actor_user_id, actor_name, actor_role,
      employee_id, employee_name, employee_org_role, to_branch_id, to_branch_label,
      to_shift, mode, valid_from, valid_to, weekdays, work_dates, note, summary, slot_id
    )
    SELECT
      s.created_at,
      CASE WHEN s.override_base THEN 'shift_override' ELSE 'rotation_create' END,
      'legacy',
      s.created_by_id, u.full_name, u.role,
      s.employee_id, e.full_name, e.org_role, s.branch_id, s.branch_label,
      s.shift_key, s.mode, s.valid_from, s.valid_to, s.weekdays, s.work_dates, s.note,
      CASE WHEN s.active THEN 'Jurnal yuritilishidan oldingi yozuv'
           ELSE 'Jurnal yuritilishidan oldingi yozuv · keyinchalik bekor qilingan' END,
      s.id
    FROM employee_work_slots s
    LEFT JOIN users u ON u.id = s.created_by_id
    LEFT JOIN employees e ON e.id = s.employee_id
  `);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const accessCache = new Map<number, { at: number; row: CoordSmenaAccess | null }>();
const CACHE_MS = 15_000;

function mapAccessRow(r: Record<string, unknown>): CoordSmenaAccess {
  return {
    userId: Number(r.user_id),
    canRotate: Boolean(r.can_rotate),
    canShift: Boolean(r.can_shift),
    scope: r.scope === "all" ? "all" : "own",
    grantedById: r.granted_by == null ? null : Number(r.granted_by),
    grantedByName: (r.granted_by_name as string | null) ?? null,
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

export async function getCoordAccess(userId: number): Promise<CoordSmenaAccess | null> {
  const hit = accessCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  await ensureSmenaAccessSchema();
  const { rows } = await pool.query(`SELECT * FROM smena_coord_access WHERE user_id = $1`, [userId]);
  const row = rows[0] ? mapAccessRow(rows[0]) : null;
  accessCache.set(userId, { at: Date.now(), row });
  return row;
}

export async function listCoordAccess(): Promise<Map<number, CoordSmenaAccess>> {
  await ensureSmenaAccessSchema();
  const { rows } = await pool.query(`SELECT * FROM smena_coord_access`);
  return new Map(rows.map((r) => [Number(r.user_id), mapAccessRow(r)]));
}

export async function setCoordAccess(
  userId: number,
  next: { canRotate: boolean; canShift: boolean; scope: SmenaScope },
  by: { id: number; name: string },
): Promise<CoordSmenaAccess | null> {
  await ensureSmenaAccessSchema();
  accessCache.delete(userId);
  if (!next.canRotate && !next.canShift) {
    await pool.query(`DELETE FROM smena_coord_access WHERE user_id = $1`, [userId]);
    return null;
  }
  const { rows } = await pool.query(
    `INSERT INTO smena_coord_access (user_id, can_rotate, can_shift, scope, granted_by, granted_by_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       can_rotate = EXCLUDED.can_rotate, can_shift = EXCLUDED.can_shift, scope = EXCLUDED.scope,
       granted_by = EXCLUDED.granted_by, granted_by_name = EXCLUDED.granted_by_name, updated_at = NOW()
     RETURNING *`,
    [userId, next.canRotate, next.canShift, next.scope, by.id, by.name],
  );
  return rows[0] ? mapAccessRow(rows[0]) : null;
}

/** Admin / HR — to‘liq; koordinator — faqat berilgan ruxsat; boshqalar — hech narsa */
export async function smenaAccessFor(role: string | null | undefined, userId: number | null | undefined): Promise<SmenaActorAccess> {
  if (canManageSmenaFilial(role)) return { full: true, canRotate: true, canShift: true, scope: "all", any: true };
  if (String(role || "").trim().toLowerCase() !== "koordinator" || !userId) {
    return { full: false, canRotate: false, canShift: false, scope: "own", any: false };
  }
  const row = await getCoordAccess(userId).catch(() => null);
  const canRotate = Boolean(row?.canRotate);
  const canShift = Boolean(row?.canShift);
  return { full: false, canRotate, canShift, scope: row?.scope ?? "own", any: canRotate || canShift };
}

export async function logSmenaChange(e: SmenaLogEntry): Promise<void> {
  try {
    await ensureSmenaAccessSchema();
    await pool.query(
      `INSERT INTO smena_change_log (
        action, actor_user_id, actor_name, actor_role, employee_id, employee_name, employee_org_role,
        from_branch_id, from_branch_label, to_branch_id, to_branch_label, from_shift, to_shift,
        mode, valid_from, valid_to, weekdays, work_dates, note, summary, slot_id, target_user_id, ip
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        e.action,
        e.actor.id,
        e.actor.name,
        e.actor.role,
        e.employee?.id ?? null,
        e.employee?.name ?? null,
        e.employee?.orgRole ?? null,
        e.fromBranch?.id ?? null,
        e.fromBranch?.label ?? null,
        e.toBranch?.id ?? null,
        e.toBranch?.label ?? null,
        e.fromShift ?? null,
        e.toShift ?? null,
        e.mode ?? null,
        e.validFrom ?? null,
        e.validTo ?? null,
        e.weekdays?.length ? JSON.stringify(e.weekdays) : null,
        e.workDates?.length ? JSON.stringify(e.workDates) : null,
        e.note ?? null,
        e.summary,
        e.slotId ?? null,
        e.targetUserId ?? null,
        e.ip ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err, action: e.action }, "smena_change_log yozilmadi");
  }
}

export type SmenaLogRow = {
  id: number;
  createdAt: string;
  action: SmenaLogAction;
  source: "live" | "legacy";
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  employeeId: number | null;
  employeeName: string | null;
  employeeOrgRole: string | null;
  fromBranchId: number | null;
  fromBranchLabel: string | null;
  toBranchId: number | null;
  toBranchLabel: string | null;
  fromShift: string | null;
  toShift: string | null;
  mode: string | null;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[] | null;
  workDates: string[] | null;
  note: string | null;
  summary: string;
  slotId: number | null;
  targetUserId: number | null;
  ip: string | null;
};

export async function querySmenaLog(f: {
  actorUserId?: number | null;
  employeeId?: number | null;
  action?: string | null;
  fromYmd?: string | null;
  toYmd?: string | null;
  q?: string | null;
  limitToActorOrEmployees?: { actorUserId: number; employeeIds: number[] } | null;
  limit: number;
}): Promise<SmenaLogRow[]> {
  await ensureSmenaAccessSchema();
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("?", `$${args.length}`));
  };
  if (f.actorUserId) add("actor_user_id = ?", f.actorUserId);
  if (f.employeeId) add("employee_id = ?", f.employeeId);
  if (f.action === "rotation") where.push(`action IN ('rotation_create','rotation_cancel','legacy_assign','legacy_day_rotation','legacy_day_rotation_cancel')`);
  else if (f.action === "shift") where.push(`action IN ('shift_change','shift_override','slot_shift_change')`);
  else if (f.action) add("action = ?", f.action);
  if (f.fromYmd) add("created_at >= (?::date AT TIME ZONE 'Asia/Tashkent')", f.fromYmd);
  if (f.toYmd) add("created_at < ((?::date + 1) AT TIME ZONE 'Asia/Tashkent')", f.toYmd);
  const q = f.q?.trim() || "";
  if (f.limitToActorOrEmployees) {
    args.push(f.limitToActorOrEmployees.actorUserId);
    const a = `$${args.length}`;
    args.push(f.limitToActorOrEmployees.employeeIds);
    const b = `$${args.length}`;
    where.push(`(actor_user_id = ${a} OR employee_id = ANY(${b}::int[]))`);
  }
  const limit = Math.max(1, Math.min(2000, f.limit));
  // Kirill/lotin qidiruvi SQL da emas — ko‘proq qator olinib, JS da filtrlanadi
  args.push(q ? 10_000 : limit);
  const { rows: raw } = await pool.query(
    `SELECT * FROM smena_change_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT $${args.length}`,
    args,
  );
  const rows = q
    ? raw
        .filter((r) =>
          scriptIncludes(
            [r.employee_name, r.actor_name, r.from_branch_label, r.to_branch_label, r.summary].filter(Boolean).join(" "),
            q,
          ),
        )
        .slice(0, limit)
    : raw;
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: new Date(r.created_at).toISOString(),
    action: r.action,
    source: r.source === "legacy" ? "legacy" : "live",
    actorUserId: r.actor_user_id ?? null,
    actorName: r.actor_name ?? null,
    actorRole: r.actor_role ?? null,
    employeeId: r.employee_id ?? null,
    employeeName: r.employee_name ?? null,
    employeeOrgRole: r.employee_org_role ?? null,
    fromBranchId: r.from_branch_id ?? null,
    fromBranchLabel: r.from_branch_label ?? null,
    toBranchId: r.to_branch_id ?? null,
    toBranchLabel: r.to_branch_label ?? null,
    fromShift: r.from_shift ?? null,
    toShift: r.to_shift ?? null,
    mode: r.mode ?? null,
    validFrom: r.valid_from ?? null,
    validTo: r.valid_to ?? null,
    weekdays: Array.isArray(r.weekdays) ? r.weekdays : null,
    workDates: Array.isArray(r.work_dates) ? r.work_dates : null,
    note: r.note ?? null,
    summary: r.summary ?? "",
    slotId: r.slot_id ?? null,
    targetUserId: r.target_user_id ?? null,
    ip: r.ip ?? null,
  }));
}

/** Jurnalda uchragan barcha amal bajaruvchilar (tarix filtri uchun) */
export async function listSmenaLogActors(): Promise<{ userId: number; name: string | null; role: string | null; total: number }[]> {
  await ensureSmenaAccessSchema();
  const { rows } = await pool.query(`
    SELECT actor_user_id, MAX(actor_name) AS name, MAX(actor_role) AS role, COUNT(*)::int AS total
    FROM smena_change_log
    WHERE actor_user_id IS NOT NULL AND action <> 'perm_change'
    GROUP BY actor_user_id
    ORDER BY MAX(actor_name)
  `);
  return rows.map((r) => ({ userId: Number(r.actor_user_id), name: r.name ?? null, role: r.role ?? null, total: Number(r.total) }));
}

/** Har bir amal bajaruvchi bo‘yicha jami va oxirgi amal (ruxsatlar jadvali uchun) */
export async function smenaLogStatsByActor(): Promise<Map<number, { total: number; last30: number; lastAt: string | null }>> {
  await ensureSmenaAccessSchema();
  const { rows } = await pool.query(`
    SELECT actor_user_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS last30,
           MAX(created_at) AS last_at
    FROM smena_change_log
    WHERE actor_user_id IS NOT NULL AND action <> 'perm_change'
    GROUP BY actor_user_id
  `);
  return new Map(
    rows.map((r) => [
      Number(r.actor_user_id),
      { total: Number(r.total), last30: Number(r.last30), lastAt: r.last_at ? new Date(r.last_at).toISOString() : null },
    ]),
  );
}
