/**
 * Resepshin — ofis tashrif / suhbat / murojaat qaydlari.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, receptionLogsTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole, hasFullPlatformAccess, isDirectorRole } from "../lib/roles";
import { ensureReceptionSchema } from "../lib/ensure-schema";

const router: IRouter = Router();

const VISIT_TYPES = new Set(["interview", "office_visit", "other"]);
const TOPICS = new Set(["delivery", "complaint", "call", "document", "package", "other"]);
const STATUSES = new Set(["waiting", "in_progress", "done", "cancelled", "no_show"]);

function canUseDesk(role: string) {
  return (
    role === "resepsion" ||
    isHrRole(role) ||
    hasFullPlatformAccess(role) ||
    isDirectorRole(role)
  );
}

function canWrite(role: string) {
  return role === "resepsion" || isHrRole(role) || hasFullPlatformAccess(role) || isDirectorRole(role);
}

function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function trimOrNull(v: unknown, max = 400): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

async function enrich(rows: (typeof receptionLogsTable.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.loggedByUserId);
    if (r.hostUserId) ids.add(r.hostUserId);
    if (r.interviewerUserId) ids.add(r.interviewerUserId);
  }
  const users = ids.size
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, [...ids]))
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    ...r,
    loggedByName: byId.get(r.loggedByUserId)?.fullName || null,
    hostUserName: r.hostUserId ? byId.get(r.hostUserId)?.fullName || null : null,
    interviewerUserName: r.interviewerUserId
      ? byId.get(r.interviewerUserId)?.fullName || null
      : null,
  }));
}

router.get("/resepsion/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  res.json({
    visitTypes: [
      { value: "interview", label: "Suhbat" },
      { value: "office_visit", label: "Ofis tashrifi" },
      { value: "other", label: "Boshqa murojaat" },
    ],
    topics: [
      { value: "delivery", label: "Yetkazib berish" },
      { value: "package", label: "Posilka / yuk" },
      { value: "document", label: "Hujjat" },
      { value: "call", label: "Telefon qo‘ng‘iroq" },
      { value: "complaint", label: "Shikoyat / murojaat" },
      { value: "other", label: "Boshqa" },
    ],
    statuses: [
      { value: "waiting", label: "Kutilmoqda" },
      { value: "in_progress", label: "Jarayonda" },
      { value: "done", label: "Yakunlandi" },
      { value: "no_show", label: "Kelmadi" },
      { value: "cancelled", label: "Bekor" },
    ],
    roleHints: [
      "Stajyor",
      "Farmasevt",
      "Mudir",
      "Koordinator",
      "Nomzod",
      "Mehmon",
      "Yetkazuvchi",
      "Hamkor",
      "Boshqa",
    ],
    canWrite: canWrite(role),
  });
});

/** Ofis xodimlari ro‘yxati — kimning oldiga / suhbatchi tanlash */
router.get("/resepsion/hosts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const q = String(req.query.q || "").trim().toLowerCase();
  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(usersTable.fullName)
    .limit(400);
  const filtered = q
    ? rows.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          String(u.role || "").toLowerCase().includes(q),
      )
    : rows;
  res.json({
    items: filtered.slice(0, 120).map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
    })),
  });
});

router.get("/resepsion/logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canUseDesk(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  await ensureReceptionSchema().catch(() => undefined);

  const visitType = String(req.query.visitType || "").trim();
  const status = String(req.query.status || "").trim();
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const search = String(req.query.q || "").trim().toLowerCase();

  const conds = [];
  if (VISIT_TYPES.has(visitType)) conds.push(eq(receptionLogsTable.visitType, visitType));
  if (STATUSES.has(status)) conds.push(eq(receptionLogsTable.status, status));
  if (from) conds.push(gte(receptionLogsTable.visitAt, from));
  if (to) conds.push(lte(receptionLogsTable.visitAt, to));

  let rows = await db
    .select()
    .from(receptionLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(receptionLogsTable.visitAt))
    .limit(500);

  if (search) {
    rows = rows.filter((r) => {
      const blob = [
        r.visitorFullName,
        r.visitorPhone,
        r.hostName,
        r.interviewerName,
        r.purpose,
        r.visitorRoleHint,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(search);
    });
  }

  const items = await enrich(rows);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayRows = items.filter((r) => {
    const t = new Date(r.visitAt).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });

  res.json({
    items,
    stats: {
      total: items.length,
      today: todayRows.length,
      waiting: items.filter((r) => r.status === "waiting").length,
      inProgress: items.filter((r) => r.status === "in_progress").length,
      interviewsToday: todayRows.filter((r) => r.visitType === "interview").length,
      visitsToday: todayRows.filter((r) => r.visitType === "office_visit").length,
    },
    canWrite: canWrite(role),
  });
});

router.post("/resepsion/logs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "Yozishga ruxsat yo‘q" });
    return;
  }
  await ensureReceptionSchema().catch(() => undefined);

  const visitType = String(req.body?.visitType || "").trim();
  if (!VISIT_TYPES.has(visitType)) {
    res.status(400).json({ error: "Tur noto‘g‘ri (suhbat / ofis tashrifi / boshqa)" });
    return;
  }
  const visitorFullName = String(req.body?.visitorFullName || "").trim();
  if (visitorFullName.length < 2) {
    res.status(400).json({ error: "Ism familiya majburiy" });
    return;
  }
  const visitAt = parseDate(req.body?.visitAt) || new Date();
  const statusRaw = String(req.body?.status || "waiting").trim();
  const status = STATUSES.has(statusRaw) ? statusRaw : "waiting";
  const topicRaw = trimOrNull(req.body?.topic, 40);
  const topic = topicRaw && TOPICS.has(topicRaw) ? topicRaw : visitType === "other" ? "other" : null;

  const [row] = await db
    .insert(receptionLogsTable)
    .values({
      visitType,
      topic,
      visitorFullName: visitorFullName.slice(0, 200),
      visitorPhone: trimOrNull(req.body?.visitorPhone, 40),
      visitorRoleHint: trimOrNull(req.body?.visitorRoleHint, 80),
      hostName: trimOrNull(req.body?.hostName, 200),
      hostUserId: req.body?.hostUserId ? Number(req.body.hostUserId) || null : null,
      interviewerName: trimOrNull(req.body?.interviewerName, 200),
      interviewerUserId: req.body?.interviewerUserId
        ? Number(req.body.interviewerUserId) || null
        : null,
      purpose: trimOrNull(req.body?.purpose, 800),
      notes: trimOrNull(req.body?.notes, 1200),
      status,
      visitAt,
      leftAt: parseDate(req.body?.leftAt),
      loggedByUserId: req.userId!,
    })
    .returning();

  const [item] = await enrich([row]);
  res.status(201).json({ ok: true, item });
});

router.patch("/resepsion/logs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "O‘zgartirishga ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(receptionLogsTable)
    .where(eq(receptionLogsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Yozuv topilmadi" });
    return;
  }

  const patch: Partial<typeof receptionLogsTable.$inferInsert> = { updatedAt: new Date() };
  if (req.body?.visitType != null) {
    const vt = String(req.body.visitType).trim();
    if (VISIT_TYPES.has(vt)) patch.visitType = vt;
  }
  if (req.body?.status != null) {
    const st = String(req.body.status).trim();
    if (STATUSES.has(st)) patch.status = st;
  }
  if (req.body?.topic != null) {
    const tp = String(req.body.topic).trim();
    patch.topic = TOPICS.has(tp) ? tp : null;
  }
  if (req.body?.visitorFullName != null) {
    const n = String(req.body.visitorFullName).trim();
    if (n.length >= 2) patch.visitorFullName = n.slice(0, 200);
  }
  if (req.body?.visitorPhone !== undefined) patch.visitorPhone = trimOrNull(req.body.visitorPhone, 40);
  if (req.body?.visitorRoleHint !== undefined)
    patch.visitorRoleHint = trimOrNull(req.body.visitorRoleHint, 80);
  if (req.body?.hostName !== undefined) patch.hostName = trimOrNull(req.body.hostName, 200);
  if (req.body?.hostUserId !== undefined)
    patch.hostUserId = req.body.hostUserId ? Number(req.body.hostUserId) || null : null;
  if (req.body?.interviewerName !== undefined)
    patch.interviewerName = trimOrNull(req.body.interviewerName, 200);
  if (req.body?.interviewerUserId !== undefined)
    patch.interviewerUserId = req.body.interviewerUserId
      ? Number(req.body.interviewerUserId) || null
      : null;
  if (req.body?.purpose !== undefined) patch.purpose = trimOrNull(req.body.purpose, 800);
  if (req.body?.notes !== undefined) patch.notes = trimOrNull(req.body.notes, 1200);
  if (req.body?.visitAt !== undefined) {
    const d = parseDate(req.body.visitAt);
    if (d) patch.visitAt = d;
  }
  if (req.body?.leftAt !== undefined) patch.leftAt = parseDate(req.body.leftAt);

  if (patch.status === "done" && !patch.leftAt && !existing.leftAt) {
    patch.leftAt = new Date();
  }

  const [row] = await db
    .update(receptionLogsTable)
    .set(patch)
    .where(eq(receptionLogsTable.id, id))
    .returning();
  const [item] = await enrich([row]);
  res.json({ ok: true, item });
});

router.delete("/resepsion/logs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  if (!canWrite(role)) {
    res.status(403).json({ error: "O‘chirishga ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const deleted = await db
    .delete(receptionLogsTable)
    .where(eq(receptionLogsTable.id, id))
    .returning({ id: receptionLogsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Yozuv topilmadi" });
    return;
  }
  res.json({ ok: true });
});

export default router;
