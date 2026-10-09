import express, { Router, type IRouter, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess } from "../lib/roles";
import { scriptIncludes } from "../lib/script-search";
import {
  CODE_RE,
  MOD_ACTIONS,
  applyLivePerms,
  conferenceHistory,
  conferenceUrl,
  deleteConference,
  endConference,
  handleLiveKitWebhook,
  ensureConferenceSchema,
  invitedUserIds,
  isModerator,
  isOwner,
  issueJoinToken,
  joinState,
  listMessages,
  liveCounts,
  liveKitConfig,
  loadConference,
  loadMember,
  moderate,
  muteAll,
  newConferenceCode,
  normalizeSettings,
  notifyConferenceUsers,
  permsFor,
  postMessage,
  raiseHand,
  setSpotlight,
  updateSettings,
  type Conference,
  type MemberRole,
  type ModAction,
} from "../lib/conferences";

const router: IRouter = Router();

type Actor = { id: number; fullName: string; role: string };

async function loadActor(req: AuthRequest): Promise<Actor | null> {
  const { rows } = await pool.query(`SELECT id, full_name, role FROM users WHERE id = $1`, [req.userId]);
  const r = rows[0];
  return r ? { id: r.id, fullName: r.full_name || "Foydalanuvchi", role: r.role || req.userRole || "" } : null;
}

function canCreate(role?: string | null): boolean {
  return hasFullPlatformAccess(role);
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function serverError(res: Response, where: string, err: unknown): void {
  console.error(where, err);
  if (!res.headersSent) res.status(503).json({ error: "Server bilan muammo — qayta urinib ko‘ring" });
}

type Ctx = { conf: Conference; actor: Actor; moderator: boolean; owner: boolean };

/** Kod bo‘yicha konferensiya va foydalanuvchi huquqlari */
async function context(req: AuthRequest, res: Response): Promise<Ctx | null> {
  const code = String(req.params.code || "").toLowerCase();
  if (!CODE_RE.test(code)) {
    fail(res, 404, "Konferensiya topilmadi");
    return null;
  }
  const [conf, actor] = await Promise.all([loadConference(code), loadActor(req)]);
  if (!actor) {
    fail(res, 401, "Kirish talab qilinadi");
    return null;
  }
  if (!conf) {
    fail(res, 404, "Konferensiya topilmadi");
    return null;
  }
  const member = await loadMember(conf.id, actor.id);
  const moderator = conf.hostId === actor.id || isModerator(member, actor.role);
  return { conf, actor, moderator, owner: isOwner(conf, actor.id, actor.role) };
}

async function requireModerator(req: AuthRequest, res: Response): Promise<Ctx | null> {
  const ctx = await context(req, res);
  if (!ctx) return null;
  if (!ctx.moderator) {
    fail(res, 403, "Faqat tashkilotchi uchun");
    return null;
  }
  return ctx;
}

type InviteeInput = { userId: number; role: MemberRole; canSpeak: boolean | null };

function parseInvitees(raw: unknown): InviteeInput[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<number, InviteeInput>();
  for (const item of raw.slice(0, 500)) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const userId = Number(r.userId);
    if (!Number.isInteger(userId) || userId <= 0) continue;
    out.set(userId, {
      userId,
      role: r.role === "cohost" ? "cohost" : "participant",
      canSpeak: typeof r.canSpeak === "boolean" ? r.canSpeak : null,
    });
  }
  return [...out.values()];
}

function parseSchedule(body: Record<string, unknown>): { scheduledAt: Date; durationMin: number } | string {
  const scheduledAt = body.scheduledAt ? new Date(String(body.scheduledAt)) : new Date();
  if (Number.isNaN(scheduledAt.getTime())) return "Vaqt noto‘g‘ri";
  if (scheduledAt.getTime() < Date.now() - 10 * 60_000) return "O‘tib ketgan vaqtni tanlab bo‘lmaydi";
  if (scheduledAt.getTime() > Date.now() + 366 * 86_400_000) return "Vaqt juda uzoq";
  const durationMin = Math.round(Number(body.durationMin) || 60);
  if (durationMin < 10 || durationMin > 600) return "Davomiylik 10–600 daqiqa bo‘lsin";
  return { scheduledAt, durationMin };
}

/** Taklif qilinganlar ro‘yxatini to‘liq almashtiradi. Yangi qo‘shilganlar qaytariladi. */
async function saveInvitees(conf: Conference, invitees: InviteeInput[]): Promise<number[]> {
  const list = invitees.filter((i) => i.userId !== conf.hostId);
  const { rows: before } = await pool.query(
    `SELECT user_id FROM conference_members WHERE conference_id = $1 AND invited`,
    [conf.id],
  );
  const had = new Set(before.map((r) => r.user_id as number));
  const ids = list.map((i) => i.userId);
  const { rows: valid } = await pool.query(`SELECT id FROM users WHERE id = ANY($1::int[]) AND status <> 'terminated'`, [ids]);
  const validIds = new Set(valid.map((r) => r.id as number));
  for (const inv of list) {
    if (!validIds.has(inv.userId)) continue;
    await pool.query(
      `INSERT INTO conference_members (conference_id, user_id, role, can_speak, invited)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (conference_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, can_speak = EXCLUDED.can_speak, invited = TRUE, banned = FALSE`,
      [conf.id, inv.userId, inv.role, inv.canSpeak],
    );
  }
  await pool.query(
    `UPDATE conference_members
        SET invited = FALSE, role = CASE WHEN role = 'cohost' THEN 'participant' ELSE role END
      WHERE conference_id = $1 AND invited AND role <> 'host' AND NOT (user_id = ANY($2::int[]))`,
    [conf.id, ids.filter((id) => validIds.has(id))],
  );
  return ids.filter((id) => validIds.has(id) && !had.has(id));
}

function confJson(conf: Conference, hostName: string, liveCount: number | undefined) {
  return {
    code: conf.code,
    title: conf.title,
    description: conf.description,
    scheduledAt: conf.scheduledAt.toISOString(),
    durationMin: conf.durationMin,
    status: conf.status,
    settings: conf.settings,
    spotlight: conf.spotlight,
    host: { id: conf.hostId, fullName: hostName },
    startedAt: conf.startedAt?.toISOString() ?? null,
    endedAt: conf.endedAt?.toISOString() ?? null,
    link: conferenceUrl(conf.code),
    liveCount: liveCount ?? 0,
  };
}

// ---------------------------------------------------------------- ro‘yxat

router.get("/conferences", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureConferenceSchema();
    const all = canCreate(req.userRole);
    const visible = all
      ? `TRUE`
      : `(c.host_id = $1 OR EXISTS (SELECT 1 FROM conference_members m WHERE m.conference_id = c.id AND m.user_id = $1 AND (m.invited OR m.joined_at IS NOT NULL OR m.role <> 'participant')))`;
    const { rows } = await pool.query(
      `SELECT c.*, u.full_name AS host_name,
              (SELECT COUNT(*)::int FROM conference_members m WHERE m.conference_id = c.id AND m.invited) AS invited_count,
              (SELECT COUNT(*)::int FROM conference_members m WHERE m.conference_id = c.id AND m.joined_at IS NOT NULL) AS attended_count,
              (SELECT MIN(s.joined_at) FROM conference_sessions s WHERE s.conference_id = c.id) AS first_join,
              (SELECT MAX(COALESCE(s.left_at, NOW())) FROM conference_sessions s WHERE s.conference_id = c.id) AS last_leave,
              me.role AS my_role, me.invited AS my_invited
         FROM conferences c
         LEFT JOIN users u ON u.id = c.host_id
         LEFT JOIN conference_members me ON me.conference_id = c.id AND me.user_id = $1
        WHERE ${visible}
          AND (c.status IN ('scheduled','live') OR c.created_at > NOW() - INTERVAL '365 days')
        ORDER BY (c.status IN ('scheduled','live')) DESC,
                 CASE WHEN c.status IN ('scheduled','live') THEN c.scheduled_at END ASC,
                 c.scheduled_at DESC
        LIMIT 300`,
      [req.userId],
    );
    const liveCodes = rows.filter((r) => r.status === "live").map((r) => r.code as string);
    const counts = (await liveCounts(liveCodes)) ?? new Map<string, number>();
    res.json({
      canCreate: all,
      serverReady: Boolean(liveKitConfig()),
      items: rows.map((r) => {
        const start = r.first_join ?? r.started_at;
        const end = r.ended_at ?? (r.status === "live" ? null : r.last_leave);
        const startMs = start ? new Date(start).getTime() : null;
        const endMs = end ? new Date(end).getTime() : null;
        return {
          code: r.code as string,
          title: r.title as string,
          description: (r.description as string) || null,
          scheduledAt: new Date(r.scheduled_at).toISOString(),
          durationMin: Number(r.duration_min) || 60,
          status: r.status as string,
          host: { id: r.host_id as number, fullName: (r.host_name as string) || "—" },
          invitedCount: Number(r.invited_count) || 0,
          attendedCount: Number(r.attended_count) || 0,
          actualStart: startMs ? new Date(startMs).toISOString() : null,
          actualEnd: endMs ? new Date(endMs).toISOString() : null,
          actualSeconds: startMs && endMs && endMs > startMs ? Math.round((endMs - startMs) / 1000) : 0,
          liveCount: counts.get(r.code as string) ?? 0,
          myRole: r.host_id === req.userId ? "host" : ((r.my_role as string) ?? null),
          canDelete: r.host_id === req.userId || all,
          invited: Boolean(r.my_invited),
          link: conferenceUrl(r.code as string),
        };
      }),
    });
  } catch (err) {
    serverError(res, "GET /conferences", err);
  }
});

/** Taklif uchun odam qidirish: ism / bo‘lim / lavozim; departmentId bilan — butun bo‘lim */
router.get("/conferences/people", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canCreate(req.userRole)) {
    const code = String(req.query.code || "");
    const conf = CODE_RE.test(code) ? await loadConference(code) : null;
    const actor = conf ? await loadMember(conf.id, req.userId!) : null;
    if (!conf || (!isModerator(actor, req.userRole) && conf.hostId !== req.userId)) {
      fail(res, 403, "Ruxsat yo‘q");
      return;
    }
  }
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    const departmentId = Number(req.query.departmentId) || null;
    const params: unknown[] = [];
    let where = `u.status <> 'terminated'`;
    if (departmentId) {
      params.push(departmentId);
      where += ` AND e.department_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.role, e.position, d.name AS department
         FROM users u
         LEFT JOIN LATERAL (
           SELECT position, department_id FROM employees WHERE user_id = u.id ORDER BY id DESC LIMIT 1
         ) e ON TRUE
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE ${where}
        ORDER BY u.full_name`,
      params,
    );
    const items = rows
      .filter((r) => !q || scriptIncludes(`${r.full_name ?? ""} ${r.position ?? ""} ${r.department ?? ""}`, q))
      .slice(0, departmentId ? 500 : 80)
      .map((r) => ({
        id: r.id as number,
        fullName: (r.full_name as string) || "—",
        role: r.role as string,
        position: (r.position as string) || null,
        department: (r.department as string) || null,
      }));
    res.json({ items });
  } catch (err) {
    serverError(res, "GET /conferences/people", err);
  }
});

router.get("/conferences/departments", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, COUNT(DISTINCT u.id)::int AS people
         FROM departments d
         JOIN employees e ON e.department_id = d.id AND e.user_id IS NOT NULL
         JOIN users u ON u.id = e.user_id AND u.status <> 'terminated'
        GROUP BY d.id, d.name
        ORDER BY d.name`,
    );
    res.json({ items: rows.map((r) => ({ id: r.id as number, name: r.name as string, people: r.people as number })) });
  } catch (err) {
    serverError(res, "GET /conferences/departments", err);
  }
});

// ---------------------------------------------------------------- yaratish / tahrirlash

router.post("/conferences", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canCreate(req.userRole)) {
    fail(res, 403, "Konferensiyani faqat admin yoki rahbar yaratadi");
    return;
  }
  try {
    await ensureConferenceSchema();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) {
      fail(res, 400, "Mavzuni kiriting");
      return;
    }
    const sched = parseSchedule(body);
    if (typeof sched === "string") {
      fail(res, 400, sched);
      return;
    }
    const description = String(body.description || "").trim().slice(0, 1000) || null;
    const settings = normalizeSettings(body.settings);
    let code = newConferenceCode();
    for (let i = 0; i < 5; i++) {
      const { rows } = await pool.query(`SELECT 1 FROM conferences WHERE code = $1`, [code]);
      if (!rows.length) break;
      code = newConferenceCode();
    }
    await pool.query(
      `INSERT INTO conferences (code, title, description, host_id, scheduled_at, duration_min, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [code, title, description, req.userId, sched.scheduledAt, sched.durationMin, JSON.stringify(settings)],
    );
    const conf = (await loadConference(code))!;
    await pool.query(
      `INSERT INTO conference_members (conference_id, user_id, role, invited) VALUES ($1, $2, 'host', TRUE)
       ON CONFLICT (conference_id, user_id) DO UPDATE SET role = 'host'`,
      [conf.id, req.userId],
    );
    const added = await saveInvitees(conf, parseInvitees(body.invitees));
    if (body.notify !== false && added.length) {
      void notifyConferenceUsers(conf, added, "invite").catch((err) => console.error("conference invite notify", err));
    }
    res.json({ ok: true, code, link: conferenceUrl(code), invited: added.length });
  } catch (err) {
    serverError(res, "POST /conferences", err);
  }
});

router.patch("/conferences/:code", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    const { conf } = ctx;
    if (conf.status === "ended" || conf.status === "cancelled") {
      fail(res, 409, "Konferensiya yakunlangan");
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = body.title != null ? String(body.title).trim().slice(0, 120) : conf.title;
    if (!title) {
      fail(res, 400, "Mavzuni kiriting");
      return;
    }
    const description =
      body.description !== undefined ? String(body.description || "").trim().slice(0, 1000) || null : conf.description;
    let scheduledAt = conf.scheduledAt;
    let durationMin = conf.durationMin;
    const requested = body.scheduledAt ? new Date(String(body.scheduledAt)) : null;
    const timeChanged = Boolean(requested && requested.getTime() !== conf.scheduledAt.getTime());
    if (timeChanged || body.durationMin !== undefined) {
      // Vaqt o‘zgarmasa (masalan, boshlangan konferensiya) faqat davomiylik tekshiriladi
      const sched = parseSchedule({
        scheduledAt: timeChanged ? body.scheduledAt : new Date().toISOString(),
        durationMin: body.durationMin ?? conf.durationMin,
      });
      if (typeof sched === "string") {
        fail(res, 400, sched);
        return;
      }
      if (timeChanged) scheduledAt = sched.scheduledAt;
      durationMin = sched.durationMin;
    }
    await pool.query(
      `UPDATE conferences SET title = $2, description = $3, scheduled_at = $4, duration_min = $5,
              reminded_at = CASE WHEN $6 THEN NULL ELSE reminded_at END, updated_at = NOW()
        WHERE id = $1`,
      [conf.id, title, description, scheduledAt, durationMin, timeChanged],
    );
    Object.assign(conf, { title, description, scheduledAt, durationMin });
    if (body.settings !== undefined) await updateSettings(conf, normalizeSettings(body.settings, conf.settings));
    let added: number[] = [];
    if (body.invitees !== undefined) {
      added = await saveInvitees(conf, parseInvitees(body.invitees));
      void applyLivePerms(conf).catch(() => undefined);
    }
    if (body.notify !== false) {
      if (added.length) {
        void notifyConferenceUsers(conf, added, conf.status === "live" ? "started" : "invite").catch(() => undefined);
      }
      if (timeChanged) {
        const others = (await invitedUserIds(conf.id, { excludeUserId: ctx.actor.id })).filter((id) => !added.includes(id));
        void notifyConferenceUsers(conf, others, "updated").catch(() => undefined);
      }
    }
    res.json({ ok: true, invited: added.length });
  } catch (err) {
    serverError(res, "PATCH /conferences/:code", err);
  }
});

router.delete("/conferences/:code", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    if (!ctx.owner) {
      fail(res, 403, "Faqat asosiy tashkilotchi bekor qiladi");
      return;
    }
    const { conf } = ctx;
    if (conf.status === "ended" || conf.status === "cancelled") {
      res.json({ ok: true });
      return;
    }
    const wasLive = conf.status === "live";
    await endConference(conf, wasLive ? "ended" : "cancelled");
    if (!wasLive && req.body?.notify !== false) {
      const ids = await invitedUserIds(conf.id, { excludeUserId: ctx.actor.id });
      void notifyConferenceUsers(conf, ids, "cancelled").catch(() => undefined);
    }
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "DELETE /conferences/:code", err);
  }
});

// ---------------------------------------------------------------- tafsilot va kirish

router.get("/conferences/:code", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const { conf, actor, moderator } = ctx;
    const member = await loadMember(conf.id, actor.id);
    const perms = permsFor(conf, member, actor.role);
    const state = joinState(conf, member, moderator);
    const { rows: hostRows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [conf.hostId]);
    const counts = conf.status === "live" ? await liveCounts([conf.code]) : null;
    let members: unknown[] | undefined;
    if (moderator) {
      const { rows } = await pool.query(
        `SELECT m.*, u.full_name, u.role AS user_role, e.position
           FROM conference_members m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN LATERAL (SELECT position FROM employees WHERE user_id = u.id ORDER BY id DESC LIMIT 1) e ON TRUE
          WHERE m.conference_id = $1
          ORDER BY (m.role = 'host') DESC, (m.role = 'cohost') DESC, u.full_name`,
        [conf.id],
      );
      members = rows.map((r) => ({
        userId: r.user_id as number,
        fullName: (r.full_name as string) || "—",
        position: (r.position as string) || null,
        role: r.role as string,
        canSpeak: typeof r.can_speak === "boolean" ? r.can_speak : null,
        invited: Boolean(r.invited),
        banned: Boolean(r.banned),
        joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
      }));
    }
    res.json({
      conference: confJson(conf, (hostRows[0]?.full_name as string) || "—", counts?.get(conf.code)),
      me: {
        userId: actor.id,
        fullName: actor.fullName,
        role: conf.hostId === actor.id ? "host" : moderator ? "cohost" : (member?.role ?? "guest"),
        moderator,
        owner: ctx.owner,
        canSpeak: perms.canSpeak,
        invited: Boolean(member?.invited),
        banned: Boolean(member?.banned),
      },
      joinable: state.joinable,
      reason: state.reason,
      serverReady: Boolean(liveKitConfig()),
      serverTime: new Date().toISOString(),
      members,
    });
  } catch (err) {
    serverError(res, "GET /conferences/:code", err);
  }
});

router.post("/conferences/:code/join", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const { conf, actor, moderator } = ctx;
    if (!liveKitConfig()) {
      fail(res, 503, "Konferensiya serveri hali sozlanmagan. Administratorga murojaat qiling.");
      return;
    }
    const member = await loadMember(conf.id, actor.id);
    const state = joinState(conf, member, moderator);
    if (!state.joinable) {
      const text: Record<string, string> = {
        ended: "Konferensiya yakunlangan",
        cancelled: "Konferensiya bekor qilingan",
        banned: "Tashkilotchi sizni bu konferensiyadan chiqargan",
        early: "Konferensiya hali boshlanmagan",
      };
      res.status(409).json({ error: text[state.reason ?? "early"], reason: state.reason });
      return;
    }
    const wasScheduled = conf.status === "scheduled";
    const ticket = await issueJoinToken(conf, actor);
    if (!ticket) {
      fail(res, 503, "Konferensiya serveri hali sozlanmagan");
      return;
    }
    // Tashkilotchi oldinroq boshlasa — eslatma hali ketmagan bo‘lsa, «boshlandi» xabari
    if (wasScheduled && moderator && conf.scheduledAt.getTime() - Date.now() > 5 * 60_000) {
      const { rowCount } = await pool.query(
        `UPDATE conferences SET reminded_at = NOW() WHERE id = $1 AND reminded_at IS NULL`,
        [conf.id],
      );
      if (rowCount) {
        const ids = await invitedUserIds(conf.id, { excludeUserId: actor.id });
        void notifyConferenceUsers(conf, ids, "started").catch(() => undefined);
      }
    }
    res.json({ ...ticket, settings: conf.settings });
  } catch (err) {
    serverError(res, "POST /conferences/:code/join", err);
  }
});

router.post("/conferences/:code/end", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    await endConference(ctx.conf, "ended");
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "POST /conferences/:code/end", err);
  }
});

// ---------------------------------------------------------------- tarix va o‘chirish

/** LiveKit → API (faqat shu server ichida, imzo bilan): kim qachon kirdi/chiqdi */
router.post(
  "/conferences/livekit-webhook",
  express.raw({ type: () => true, limit: "1mb" }),
  async (req, res): Promise<void> => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      await handleLiveKitWebhook(body, req.get("Authorization") ?? undefined);
      res.json({ ok: true });
    } catch (err) {
      console.warn("POST /conferences/livekit-webhook", (err as Error)?.message);
      res.status(401).json({ error: "invalid webhook" });
    }
  },
);

router.get("/conferences/:code/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureConferenceSchema();
    const ctx = await context(req, res);
    if (!ctx) return;
    const member = await loadMember(ctx.conf.id, ctx.actor.id);
    if (!ctx.moderator && !member) {
      fail(res, 403, "Ruxsat yo‘q");
      return;
    }
    const { rows: hostRows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [ctx.conf.hostId]);
    const history = await conferenceHistory(ctx.conf);
    res.json({
      conference: confJson(ctx.conf, (hostRows[0]?.full_name as string) || "—", undefined),
      canDelete: ctx.owner,
      ...history,
      // Qatnashuv faqat tashkilotchiga; oddiy ishtirokchi faqat o‘zini ko‘radi
      attendance: ctx.moderator ? history.attendance : history.attendance.filter((a) => a.userId === ctx.actor.id),
    });
  } catch (err) {
    serverError(res, "GET /conferences/:code/history", err);
  }
});

router.delete("/conferences/:code/purge", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    if (!ctx.owner) {
      fail(res, 403, "Faqat asosiy tashkilotchi o‘chira oladi");
      return;
    }
    const { conf } = ctx;
    if (conf.status === "scheduled") {
      const ids = await invitedUserIds(conf.id, { excludeUserId: ctx.actor.id });
      await endConference(conf, "cancelled");
      void notifyConferenceUsers(conf, ids, "cancelled").catch(() => undefined);
    }
    await deleteConference(conf);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "DELETE /conferences/:code/purge", err);
  }
});

// ---------------------------------------------------------------- xona ichida

router.post("/conferences/:code/moderate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    const action = String(req.body?.action || "") as ModAction;
    if (action === ("mute-all" as ModAction)) {
      const count = await muteAll(ctx.conf);
      res.json({ ok: true, count });
      return;
    }
    const userId = Number(req.body?.userId);
    if (!MOD_ACTIONS.includes(action) || !Number.isInteger(userId) || userId <= 0) {
      fail(res, 400, "Noto‘g‘ri buyruq");
      return;
    }
    const out = await moderate(ctx.conf, { id: ctx.actor.id, role: ctx.actor.role }, userId, action);
    if (!out.ok) {
      fail(res, out.status, out.error);
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "POST /conferences/:code/moderate", err);
  }
});

router.put("/conferences/:code/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    const settings = normalizeSettings(req.body?.settings, ctx.conf.settings);
    await updateSettings(ctx.conf, settings);
    res.json({ ok: true, settings });
  } catch (err) {
    serverError(res, "PUT /conferences/:code/settings", err);
  }
});

router.put("/conferences/:code/spotlight", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await requireModerator(req, res);
    if (!ctx) return;
    const userId = Number(req.body?.userId);
    const raw = String(req.body?.source || "auto");
    const source = raw === "camera" || raw === "screen" ? raw : "auto";
    await setSpotlight(ctx.conf, Number.isInteger(userId) && userId > 0 ? { userId, source } : null);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "PUT /conferences/:code/spotlight", err);
  }
});

router.post("/conferences/:code/hand", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    await raiseHand(ctx.conf, ctx.actor.id, Boolean(req.body?.raised));
    res.json({ ok: true });
  } catch (err) {
    serverError(res, "POST /conferences/:code/hand", err);
  }
});

router.get("/conferences/:code/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    res.json({ items: await listMessages(ctx.conf.id) });
  } catch (err) {
    serverError(res, "GET /conferences/:code/messages", err);
  }
});

const lastMessageAt = new Map<number, number>();

router.post("/conferences/:code/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const { conf, actor, moderator } = ctx;
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!text) {
      fail(res, 400, "Xabar bo‘sh");
      return;
    }
    if (conf.status !== "live") {
      fail(res, 409, "Konferensiya faol emas");
      return;
    }
    if (!conf.settings.chat && !moderator) {
      fail(res, 403, "Tashkilotchi chatni o‘chirgan");
      return;
    }
    const member = await loadMember(conf.id, actor.id);
    if (member?.banned) {
      fail(res, 403, "Ruxsat yo‘q");
      return;
    }
    const prev = lastMessageAt.get(actor.id) ?? 0;
    if (Date.now() - prev < 400) {
      fail(res, 429, "Juda tez — biroz kuting");
      return;
    }
    lastMessageAt.set(actor.id, Date.now());
    res.json({ message: await postMessage(conf, actor, text) });
  } catch (err) {
    serverError(res, "POST /conferences/:code/messages", err);
  }
});

export default router;
