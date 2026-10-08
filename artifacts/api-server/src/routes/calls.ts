import { Router, type IRouter, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  acceptCall,
  attachClient,
  callFor,
  endCall,
  ensureCallSchema,
  hasCallPermission,
  iceServersFor,
  isCallAdmin,
  isOnline,
  loadCallUser,
  onlineUserIds,
  relaySignal,
  setCallPermission,
  startCall,
} from "../lib/calls";

const router: IRouter = Router();

const CID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function cidOf(req: AuthRequest): string | null {
  const raw = String(req.header("x-call-client") || req.body?.cid || req.query.cid || "");
  return CID_RE.test(raw) ? raw : null;
}

function denyUnlessAdmin(req: AuthRequest, res: Response): boolean {
  if (isCallAdmin(req.userRole)) return false;
  res.status(403).json({ error: "Faqat admin uchun" });
  return true;
}

router.get("/calls/stream", requireAuth, (req: AuthRequest, res): void => {
  const cid = cidOf(req);
  if (!cid) {
    res.status(400).json({ error: "cid kerak" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  attachClient(req.userId!, cid, res);
});

router.get("/calls/config", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const admin = isCallAdmin(req.userRole);
    res.json({
      me: { id: req.userId, isAdmin: admin, canCall: admin || (await hasCallPermission(req.userId!)) },
      iceServers: iceServersFor(req.userId!),
    });
  } catch (err) {
    console.error("GET /calls/config", err);
    res.status(503).json({ error: "Sozlama yuklanmadi" });
  }
});

/** Admin — istalgan xodim; xodim — faqat adminlar */
router.get("/calls/contacts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureCallSchema();
    const admin = isCallAdmin(req.userRole);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const onlyOnline = admin && String(req.query.online || "") === "1";
    const params: unknown[] = [req.userId];
    let where = `u.id <> $1 AND u.status <> 'terminated'`;
    if (!admin) where += ` AND u.role = 'admin'`;
    if (onlyOnline) {
      const ids = onlineUserIds();
      if (!ids.length) {
        res.json({ items: [], onlineTotal: 0 });
        return;
      }
      params.push(ids);
      where += ` AND u.id = ANY($${params.length}::int[])`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (u.full_name ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR e.location ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.role, e.position, COALESCE(NULLIF(TRIM(e.location), ''), NULL) AS branch,
              (cp.user_id IS NOT NULL) AS can_call
         FROM users u
         LEFT JOIN LATERAL (
           SELECT position, location FROM employees WHERE user_id = u.id ORDER BY id DESC LIMIT 1
         ) e ON TRUE
         LEFT JOIN call_permissions cp ON cp.user_id = u.id
        WHERE ${where}
        ORDER BY u.full_name
        LIMIT ${admin ? 300 : 50}`,
      params,
    );
    const items = rows
      .map((r) => ({
        id: r.id as number,
        fullName: r.full_name as string,
        role: r.role as string,
        position: (r.position as string) || null,
        branch: (r.branch as string) || null,
        canCall: Boolean(r.can_call) || isCallAdmin(r.role),
        online: isOnline(r.id),
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.fullName.localeCompare(b.fullName, "uz"))
      .slice(0, admin ? 80 : 50);
    res.json({ items, onlineTotal: onlineUserIds().filter((id) => id !== req.userId).length });
  } catch (err) {
    console.error("GET /calls/contacts", err);
    res.status(503).json({ error: "Ro‘yxat yuklanmadi" });
  }
});

router.get("/calls/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    await ensureCallSchema();
    const { rows } = await pool.query(
      `SELECT l.call_id, l.caller_id, l.callee_id, l.video, l.status, l.created_at, l.answered_at, l.ended_at,
              cu.full_name AS caller_name, cu.role AS caller_role, ce.full_name AS callee_name, ce.role AS callee_role
         FROM call_logs l
         LEFT JOIN users cu ON cu.id = l.caller_id
         LEFT JOIN users ce ON ce.id = l.callee_id
        WHERE l.caller_id = $1 OR l.callee_id = $1
        ORDER BY l.created_at DESC
        LIMIT 60`,
      [req.userId],
    );
    res.json({
      items: rows.map((r) => {
        const outgoing = r.caller_id === req.userId;
        const answered = r.answered_at ? new Date(r.answered_at).getTime() : null;
        const ended = r.ended_at ? new Date(r.ended_at).getTime() : null;
        return {
          id: r.call_id as string,
          outgoing,
          video: Boolean(r.video),
          status: r.status as string,
          createdAt: new Date(r.created_at).toISOString(),
          durationSec: answered && ended ? Math.max(0, Math.round((ended - answered) / 1000)) : 0,
          peer: {
            id: outgoing ? r.callee_id : r.caller_id,
            fullName: (outgoing ? r.callee_name : r.caller_name) || "—",
            role: (outgoing ? r.callee_role : r.caller_role) || "",
          },
        };
      }),
    });
  } catch (err) {
    console.error("GET /calls/history", err);
    res.status(503).json({ error: "Tarix yuklanmadi" });
  }
});

router.post("/calls", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cid = cidOf(req);
  const calleeId = Number(req.body?.calleeId);
  if (!cid || !Number.isInteger(calleeId) || calleeId <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri so‘rov" });
    return;
  }
  try {
    const caller = await loadCallUser(req.userId!);
    if (!caller) {
      res.status(401).json({ error: "Kirish talab qilinadi" });
      return;
    }
    const out = await startCall({ caller, calleeId, video: Boolean(req.body?.video), cid });
    if (!out.ok) {
      res.status(out.status).json({ error: out.error, code: out.code });
      return;
    }
    res.json({ call: out.call, iceServers: iceServersFor(req.userId!) });
  } catch (err) {
    console.error("POST /calls", err);
    res.status(503).json({ error: "Qo‘ng‘iroq boshlanmadi" });
  }
});

router.post("/calls/:id/accept", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cid = cidOf(req);
  if (!cid) {
    res.status(400).json({ error: "cid kerak" });
    return;
  }
  const out = await acceptCall(String(req.params.id), req.userId!, cid);
  if (!out.ok) {
    res.status(409).json({ error: out.error });
    return;
  }
  res.json({ ok: true, iceServers: iceServersFor(req.userId!) });
});

router.post("/calls/:id/end", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = String(req.params.id);
  const call = callFor(id);
  if (call && call.callerId !== req.userId && call.calleeId !== req.userId) {
    res.status(403).json({ error: "Bu qo‘ng‘iroq ishtirokchisi emassiz" });
    return;
  }
  const raw = String(req.body?.reason || "hangup");
  const reason = ["hangup", "declined", "failed"].includes(raw) ? raw : "hangup";
  await endCall(id, req.userId!, reason);
  res.json({ ok: true });
});

router.post("/calls/:id/signal", requireAuth, (req: AuthRequest, res): void => {
  const cid = cidOf(req);
  const data = req.body?.data;
  if (!cid || !data || typeof data !== "object") {
    res.status(400).json({ error: "Noto‘g‘ri signal" });
    return;
  }
  const out = relaySignal(String(req.params.id), req.userId!, cid, data);
  if (!out.ok) {
    res.status(409).json({ error: out.error });
    return;
  }
  res.json({ ok: true });
});

router.get("/calls/permissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessAdmin(req, res)) return;
  try {
    await ensureCallSchema();
    const { rows } = await pool.query(
      `SELECT cp.user_id, cp.granted_by_name, cp.granted_at, u.full_name, u.role
         FROM call_permissions cp JOIN users u ON u.id = cp.user_id
        ORDER BY u.full_name`,
    );
    res.json({
      items: rows.map((r) => ({
        userId: r.user_id as number,
        fullName: r.full_name as string,
        role: r.role as string,
        grantedByName: (r.granted_by_name as string) || null,
        grantedAt: new Date(r.granted_at).toISOString(),
        online: isOnline(r.user_id),
      })),
    });
  } catch (err) {
    console.error("GET /calls/permissions", err);
    res.status(503).json({ error: "Ruxsatlar yuklanmadi" });
  }
});

router.put("/calls/permissions/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessAdmin(req, res)) return;
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0 || typeof req.body?.allowed !== "boolean") {
    res.status(400).json({ error: "Noto‘g‘ri so‘rov" });
    return;
  }
  try {
    const me = await loadCallUser(req.userId!);
    await setCallPermission(userId, req.body.allowed, { id: req.userId!, name: me?.fullName || "Admin" });
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /calls/permissions", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

export default router;
