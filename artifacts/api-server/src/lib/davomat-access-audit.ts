import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db, davomatAccessAuditTable, employeesTable, usersTable, zonePresenceRulesTable } from "@workspace/db";
import { effectiveDavomatAccess } from "./davomat-method-access";
import { displayBranchName } from "./geo-location";
import { logger } from "./logger";

export type AuditAction = "method" | "zone" | "zone_unlock" | "finger_enroll" | "finger_reset";

export type MethodState = { face: boolean; qr: boolean; finger: boolean };
export type ZoneState = {
  enabled: boolean;
  intervalHours: number;
  windowMinutes: number;
  method: "FACE_ID" | "QR";
};

export type AuditChange = {
  targetUserId: number;
  action: AuditAction;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/** Bloklash oynasini ochish va o‘zgartirish huquqi bor rollar (hasFullPlatformAccess bilan bir xil). */
export const ACCESS_EDITOR_ROLES = ["admin", "asoschi", "director"] as const;

/** Xodim ekranda ko‘radigan amaldagi Face ID / QR holati (rol standarti hisobga olingan). */
export async function methodStatesOf(userIds: number[]): Promise<Map<number, MethodState>> {
  const map = new Map<number, MethodState>();
  if (!userIds.length) return map;
  const rows = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      face: usersTable.davomatFaceAllowed,
      qr: usersTable.davomatQrAllowed,
      finger: usersTable.davomatFingerAllowed,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  for (const r of rows) {
    const eff = effectiveDavomatAccess(r.role, r.face, r.qr, r.finger);
    map.set(r.id, { face: eff.face, qr: eff.qr, finger: eff.finger });
  }
  return map;
}

export async function zoneStateOf(userId: number): Promise<ZoneState> {
  const [rule] = await db
    .select({
      enabled: zonePresenceRulesTable.enabled,
      intervalHours: zonePresenceRulesTable.intervalHours,
      windowMinutes: zonePresenceRulesTable.windowMinutes,
      method: zonePresenceRulesTable.method,
    })
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, userId))
    .limit(1);
  return {
    enabled: Boolean(rule?.enabled),
    intervalHours: rule?.intervalHours ?? 2,
    windowMinutes: rule?.windowMinutes ?? 15,
    method: rule?.method === "QR" ? "QR" : "FACE_ID",
  };
}

function sameState(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

async function targetSnapshots(userIds: number[]) {
  const map = new Map<number, { name: string; position: string | null; location: string | null }>();
  if (!userIds.length) return map;
  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  const emps = await db
    .select({ userId: employeesTable.userId, position: employeesTable.position, location: employeesTable.location })
    .from(employeesTable)
    .where(inArray(employeesTable.userId, userIds));
  const empByUser = new Map<number, (typeof emps)[number]>();
  for (const e of emps) if (e.userId != null && !empByUser.has(e.userId)) empByUser.set(e.userId, e);
  for (const u of users) {
    const emp = empByUser.get(u.id);
    map.set(u.id, {
      name: u.fullName,
      position: emp?.position?.trim() || null,
      location: displayBranchName(emp?.location) || null,
    });
  }
  return map;
}

/**
 * Faqat haqiqatan o‘zgargan qatorlarni yozadi. Tarix yozilmasa ham asosiy amal to‘xtamaydi.
 */
export async function recordAccessChanges(
  changes: AuditChange[],
  ctx: { actorUserId: number | null | undefined; ipAddress?: string | null },
): Promise<void> {
  const real = changes.filter((c) => !sameState(c.before, c.after));
  if (!real.length) return;
  try {
    const [actor] = ctx.actorUserId
      ? await db
          .select({ fullName: usersTable.fullName, role: usersTable.role, login: usersTable.login })
          .from(usersTable)
          .where(eq(usersTable.id, ctx.actorUserId))
          .limit(1)
      : [];
    const targets = await targetSnapshots([...new Set(real.map((c) => c.targetUserId))]);
    const batchId = real.length > 1 ? randomUUID() : null;
    const now = new Date();
    await db.insert(davomatAccessAuditTable).values(
      real.map((c) => {
        const t = targets.get(c.targetUserId);
        return {
          createdAt: now,
          actorUserId: ctx.actorUserId ?? null,
          actorName: actor?.fullName || "Noma’lum",
          actorRole: actor?.role ?? null,
          actorLogin: actor?.login ?? null,
          action: c.action,
          batchId,
          batchSize: batchId ? real.length : null,
          targetUserId: c.targetUserId,
          targetName: t?.name || `#${c.targetUserId}`,
          targetPosition: t?.position ?? null,
          targetLocation: t?.location ?? null,
          before: c.before,
          after: c.after,
          ipAddress: ctx.ipAddress ?? null,
        };
      }),
    );
  } catch (err) {
    logger.error({ err, count: real.length }, "davomat access audit yozilmadi");
  }
}

export type AuditListFilters = {
  q?: string;
  actorUserId?: number;
  targetUserId?: number;
  action?: AuditAction;
  /** YYYY-MM-DD, Toshkent vaqti bo‘yicha (shu kun kiradi) */
  from?: string;
  to?: string;
  limit: number;
  offset: number;
};

function tashkentDayStart(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listAccessAudit(f: AuditListFilters) {
  const where = [];
  if (f.actorUserId) where.push(eq(davomatAccessAuditTable.actorUserId, f.actorUserId));
  if (f.targetUserId) where.push(eq(davomatAccessAuditTable.targetUserId, f.targetUserId));
  if (f.action) where.push(eq(davomatAccessAuditTable.action, f.action));
  const from = f.from ? tashkentDayStart(f.from) : null;
  if (from) where.push(gte(davomatAccessAuditTable.createdAt, from));
  const to = f.to ? tashkentDayStart(f.to) : null;
  if (to) where.push(lt(davomatAccessAuditTable.createdAt, new Date(to.getTime() + 86_400_000)));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    where.push(
      or(
        ilike(davomatAccessAuditTable.targetName, like),
        ilike(davomatAccessAuditTable.actorName, like),
        ilike(davomatAccessAuditTable.targetLocation, like),
        ilike(davomatAccessAuditTable.targetPosition, like),
      )!,
    );
  }
  const cond = where.length ? and(...where) : undefined;
  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(davomatAccessAuditTable)
      .where(cond)
      .orderBy(desc(davomatAccessAuditTable.createdAt), desc(davomatAccessAuditTable.id))
      .limit(f.limit)
      .offset(f.offset),
    db.select({ total: count() }).from(davomatAccessAuditTable).where(cond),
  ]);
  return { items, total: Number(total) };
}

/** Kim necha marta o‘zgartirgan — filtr ro‘yxati va «Ruxsati borlar» uchun. */
export async function auditActorStats() {
  return db
    .select({
      actorUserId: davomatAccessAuditTable.actorUserId,
      actorName: sql<string>`max(${davomatAccessAuditTable.actorName})`,
      changes: count(),
      lastAt: sql<Date>`max(${davomatAccessAuditTable.createdAt})`,
    })
    .from(davomatAccessAuditTable)
    .groupBy(davomatAccessAuditTable.actorUserId);
}

export async function accessEditors() {
  return db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      login: usersTable.login,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(inArray(usersTable.role, [...ACCESS_EDITOR_ROLES]))
    .orderBy(usersTable.fullName);
}
