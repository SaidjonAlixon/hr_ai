/**
 * Qo‘ng‘iroqlar: xodim ↔ admin (WebRTC). Server faqat signal uzatadi — ovoz/video
 * to‘g‘ridan-to‘g‘ri yoki TURN orqali ketadi. Holat xotirada: API bitta nusxada ishlaydi.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendWebPushToUser } from "./web-push";

export const CALL_ADMIN_ROLES = new Set(["admin"]);
const RING_MS = 45_000;
const RECONNECT_GRACE_MS = 30_000;
/** Faol qo‘ng‘iroqda media P2P ketadi — signal oqimi uzilsa ham suhbat davom etadi; bu faqat zaxira tozalash */
const ACTIVE_GRACE_MS = 120_000;
const HEARTBEAT_MS = 20_000;

export function isCallAdmin(role?: string | null): boolean {
  return CALL_ADMIN_ROLES.has(String(role || "").trim().toLowerCase());
}

// ---------------------------------------------------------------- jadvallar

let ready: Promise<void> | null = null;

export function ensureCallSchema(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS call_permissions (
         user_id INT PRIMARY KEY,
         granted_by INT,
         granted_by_name TEXT,
         granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );
       CREATE TABLE IF NOT EXISTS call_logs (
         id SERIAL PRIMARY KEY,
         call_id TEXT NOT NULL UNIQUE,
         caller_id INT NOT NULL,
         callee_id INT NOT NULL,
         video BOOLEAN NOT NULL DEFAULT FALSE,
         status TEXT NOT NULL DEFAULT 'ringing',
         end_reason TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         answered_at TIMESTAMPTZ,
         ended_at TIMESTAMPTZ
       );
       CREATE INDEX IF NOT EXISTS call_logs_caller_idx ON call_logs (caller_id, created_at DESC);
       CREATE INDEX IF NOT EXISTS call_logs_callee_idx ON call_logs (callee_id, created_at DESC);`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

const permCache = new Map<number, { at: number; ok: boolean }>();

export async function hasCallPermission(userId: number): Promise<boolean> {
  const hit = permCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  await ensureCallSchema();
  const { rows } = await pool.query(`SELECT 1 FROM call_permissions WHERE user_id = $1`, [userId]);
  const ok = rows.length > 0;
  permCache.set(userId, { at: Date.now(), ok });
  return ok;
}

export async function setCallPermission(userId: number, allowed: boolean, by: { id: number; name: string }) {
  await ensureCallSchema();
  if (allowed) {
    await pool.query(
      `INSERT INTO call_permissions (user_id, granted_by, granted_by_name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_by_name = EXCLUDED.granted_by_name, granted_at = NOW()`,
      [userId, by.id, by.name],
    );
  } else {
    await pool.query(`DELETE FROM call_permissions WHERE user_id = $1`, [userId]);
  }
  permCache.delete(userId);
  pushTo(userId, "perm", { canCall: allowed });
}

export type CallUser = { id: number; fullName: string; role: string; status: string; phone: string | null };

export async function loadCallUser(id: number): Promise<CallUser | null> {
  const { rows } = await pool.query(`SELECT id, full_name, role, status, phone FROM users WHERE id = $1`, [id]);
  const r = rows[0];
  return r ? { id: r.id, fullName: r.full_name, role: r.role, status: r.status, phone: r.phone ?? null } : null;
}

// ---------------------------------------------------------------- SSE mijozlar

type Client = { cid: string; userId: number; res: Response; heartbeat: ReturnType<typeof setInterval> };

const clients = new Map<number, Map<string, Client>>();
const dropTimers = new Map<string, ReturnType<typeof setTimeout>>();

function write(c: Client, event: string, data: unknown) {
  try {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* uzilgan */
  }
}

function pushTo(userId: number, event: string, data: unknown, onlyCid?: string | null) {
  const set = clients.get(userId);
  if (!set) return 0;
  let n = 0;
  for (const c of set.values()) {
    if (onlyCid && c.cid !== onlyCid) continue;
    write(c, event, data);
    n += 1;
  }
  return n;
}

export function isOnline(userId: number): boolean {
  return (clients.get(userId)?.size ?? 0) > 0;
}

export function onlineUserIds(): number[] {
  return [...clients.keys()];
}

export function attachClient(userId: number, cid: string, res: Response) {
  const old = clients.get(userId)?.get(cid);
  if (old) {
    clearInterval(old.heartbeat);
    try {
      old.res.end();
    } catch {
      /* */
    }
  }
  const drop = dropTimers.get(cid);
  if (drop) {
    clearTimeout(drop);
    dropTimers.delete(cid);
  }
  const c: Client = {
    cid,
    userId,
    res,
    heartbeat: setInterval(() => {
      try {
        res.write(`: hb\n\n`);
      } catch {
        /* */
      }
    }, HEARTBEAT_MS),
  };
  if (!clients.has(userId)) clients.set(userId, new Map());
  clients.get(userId)!.set(cid, c);
  write(c, "hello", { cid, serverTime: Date.now() });

  for (const call of calls.values()) {
    if (call.status === "ringing" && call.calleeId === userId) write(c, "incoming", publicCall(call));
    if (call.status === "active" && (call.callerCid === cid || call.calleeCid === cid)) write(c, "resume", publicCall(call));
  }

  res.on("close", () => {
    clearInterval(c.heartbeat);
    const set = clients.get(userId);
    if (set?.get(cid) === c) set.delete(cid);
    if (set && !set.size) clients.delete(userId);
    const sweep = (activeToo: boolean) => {
      if (clients.get(userId)?.has(cid)) return;
      for (const call of calls.values()) {
        if (call.callerCid !== cid && call.calleeCid !== cid) continue;
        if (call.status === "ringing" || activeToo) void endCall(call.id, userId, "disconnected");
      }
    };
    dropTimers.set(
      cid,
      setTimeout(() => {
        sweep(false);
        dropTimers.set(
          cid,
          setTimeout(() => {
            dropTimers.delete(cid);
            sweep(true);
          }, ACTIVE_GRACE_MS - RECONNECT_GRACE_MS),
        );
      }, RECONNECT_GRACE_MS),
    );
  });
}

// ---------------------------------------------------------------- qo‘ng‘iroqlar

type CallStatus = "ringing" | "active" | "ended";

type Call = {
  id: string;
  callerId: number;
  calleeId: number;
  callerName: string;
  calleeName: string;
  callerRole: string;
  calleeRole: string;
  video: boolean;
  status: CallStatus;
  callerCid: string;
  calleeCid: string | null;
  createdAt: number;
  answeredAt: number | null;
  ringTimer: ReturnType<typeof setTimeout> | null;
};

const calls = new Map<string, Call>();

function publicCall(c: Call) {
  return {
    id: c.id,
    video: c.video,
    status: c.status,
    createdAt: c.createdAt,
    answeredAt: c.answeredAt,
    caller: { id: c.callerId, fullName: c.callerName, role: c.callerRole },
    callee: { id: c.calleeId, fullName: c.calleeName, role: c.calleeRole },
  };
}

function busy(userId: number): boolean {
  for (const c of calls.values()) {
    if (c.status === "ended") continue;
    if (c.callerId === userId || c.calleeId === userId) return true;
  }
  return false;
}

export function callFor(id: string): Call | undefined {
  return calls.get(id);
}

async function logStatus(id: string, status: string, extra: { answered?: boolean; ended?: boolean; reason?: string } = {}) {
  await pool
    .query(
      `UPDATE call_logs SET status = $2,
         answered_at = CASE WHEN $3 THEN NOW() ELSE answered_at END,
         ended_at = CASE WHEN $4 THEN NOW() ELSE ended_at END,
         end_reason = COALESCE($5, end_reason)
       WHERE call_id = $1`,
      [id, status, Boolean(extra.answered), Boolean(extra.ended), extra.reason ?? null],
    )
    .catch((err) => logger.warn({ err }, "call log"));
}

export type StartResult = { ok: true; call: ReturnType<typeof publicCall> } | { ok: false; status: number; error: string; code?: string };

export async function startCall(input: {
  caller: CallUser;
  calleeId: number;
  video: boolean;
  cid: string;
}): Promise<StartResult> {
  await ensureCallSchema();
  const { caller, calleeId, video, cid } = input;
  if (calleeId === caller.id) return { ok: false, status: 400, error: "O‘zingizga qo‘ng‘iroq qilib bo‘lmaydi" };
  const callee = await loadCallUser(calleeId);
  if (!callee || callee.status === "terminated") return { ok: false, status: 404, error: "Xodim topilmadi" };

  const callerAdmin = isCallAdmin(caller.role);
  if (!callerAdmin) {
    if (!isCallAdmin(callee.role)) return { ok: false, status: 403, error: "Faqat admin bilan gaplashish mumkin" };
    if (!(await hasCallPermission(caller.id))) {
      return { ok: false, status: 403, error: "Qo‘ng‘iroq qilish uchun admin ruxsati kerak", code: "no_permission" };
    }
  }
  if (busy(caller.id)) return { ok: false, status: 409, error: "Sizda faol qo‘ng‘iroq bor", code: "self_busy" };
  if (!isOnline(callee.id)) {
    return { ok: false, status: 409, error: `${callee.fullName} hozir platformada emas (oflayn)`, code: "offline" };
  }

  const id = randomUUID();
  await pool.query(`INSERT INTO call_logs (call_id, caller_id, callee_id, video) VALUES ($1, $2, $3, $4)`, [
    id,
    caller.id,
    callee.id,
    video,
  ]);

  if (busy(callee.id)) {
    await logStatus(id, "busy", { ended: true });
    return { ok: false, status: 409, error: `${callee.fullName} hozir boshqa qo‘ng‘iroqda`, code: "busy" };
  }

  const call: Call = {
    id,
    callerId: caller.id,
    calleeId: callee.id,
    callerName: caller.fullName,
    calleeName: callee.fullName,
    callerRole: caller.role,
    calleeRole: callee.role,
    video,
    status: "ringing",
    callerCid: cid,
    calleeCid: null,
    createdAt: Date.now(),
    answeredAt: null,
    ringTimer: null,
  };
  calls.set(id, call);
  call.ringTimer = setTimeout(() => void endCall(id, null, "missed"), RING_MS);

  pushTo(callee.id, "incoming", publicCall(call));
  void sendWebPushToUser(callee.id, {
    title: video ? "📹 Video qo‘ng‘iroq" : "📞 Qo‘ng‘iroq",
    body: `${caller.fullName} sizga qo‘ng‘iroq qilmoqda`,
    url: `/qongiroq?call=${id}`,
    tag: `call-${id}`,
  }).catch(() => undefined);

  return { ok: true, call: publicCall(call) };
}

export async function acceptCall(id: string, userId: number, cid: string): Promise<{ ok: boolean; error?: string }> {
  const call = calls.get(id);
  if (!call || call.status === "ended") return { ok: false, error: "Qo‘ng‘iroq tugagan" };
  if (call.calleeId !== userId) return { ok: false, error: "Bu qo‘ng‘iroq sizga emas" };
  if (call.status === "active") return { ok: false, error: "Boshqa qurilmada ko‘tarilgan" };
  if (call.ringTimer) clearTimeout(call.ringTimer);
  call.ringTimer = null;
  call.status = "active";
  call.calleeCid = cid;
  call.answeredAt = Date.now();
  await logStatus(id, "answered", { answered: true });
  const data = publicCall(call);
  pushTo(call.callerId, "accepted", data, call.callerCid);
  const set = clients.get(userId);
  if (set) for (const c of set.values()) if (c.cid !== cid) write(c, "taken", { id });
  return { ok: true };
}

const FINAL: Record<string, string> = {
  missed: "missed",
  declined: "declined",
  cancelled: "cancelled",
  hangup: "ended",
  disconnected: "ended",
  failed: "failed",
};

export async function endCall(id: string, byUserId: number | null, reason: string): Promise<boolean> {
  const call = calls.get(id);
  if (!call || call.status === "ended") return false;
  const wasRinging = call.status === "ringing";
  if (call.ringTimer) clearTimeout(call.ringTimer);
  call.status = "ended";
  calls.delete(id);
  let status = FINAL[reason] ?? "ended";
  if (wasRinging && reason === "hangup") status = byUserId === call.callerId ? "cancelled" : "declined";
  await logStatus(id, status, { ended: true, reason });
  const payload = { id, reason: status, by: byUserId };
  if (byUserId !== call.callerId) pushTo(call.callerId, "ended", payload, call.callerCid);
  // Jiringlayotgan bo‘lsa — barcha qurilmalarida to‘xtasin
  if (wasRinging) pushTo(call.calleeId, "ended", payload);
  else if (byUserId !== call.calleeId) pushTo(call.calleeId, "ended", payload, call.calleeCid);
  return true;
}

export function relaySignal(id: string, fromUserId: number, fromCid: string, data: unknown): { ok: boolean; error?: string } {
  const call = calls.get(id);
  if (!call || call.status === "ended") return { ok: false, error: "Qo‘ng‘iroq tugagan" };
  if (fromUserId === call.callerId && fromCid === call.callerCid) {
    if (!call.calleeCid) return { ok: false, error: "Hali ko‘tarilmagan" };
    pushTo(call.calleeId, "signal", { id, data }, call.calleeCid);
    return { ok: true };
  }
  if (fromUserId === call.calleeId && fromCid === call.calleeCid) {
    pushTo(call.callerId, "signal", { id, data }, call.callerCid);
    return { ok: true };
  }
  return { ok: false, error: "Bu qo‘ng‘iroq ishtirokchisi emassiz" };
}

// ---------------------------------------------------------------- TURN

export function iceServersFor(userId: number) {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
  const secret = process.env.TURN_SECRET?.trim();
  const urls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (secret && urls.length) {
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    const stun = urls.filter((u) => u.startsWith("stun:"));
    const turn = urls.filter((u) => u.startsWith("turn:") || u.startsWith("turns:"));
    if (stun.length) servers.push({ urls: stun });
    if (turn.length) servers.push({ urls: turn, username, credential });
  }
  servers.push({ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] });
  return servers;
}
