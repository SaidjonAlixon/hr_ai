/**
 * Konferensiyalar (guruh video uchrashuv). Ovoz/video LiveKit SFU orqali ketadi —
 * API faqat kirish tokeni, moderatsiya, chat va bildirishnomalarni boshqaradi.
 * Moderatsiya buyruqlari faqat serverdan yuboriladi: mijozlar bir-birini boshqara olmaydi.
 */
import { randomInt } from "node:crypto";
import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  type ParticipantInfo,
} from "livekit-server-sdk";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { hasFullPlatformAccess } from "./roles";
import { notifyUser } from "./notify";
import { escapeHtml, isTelegramConfigured, publicAppUrl, sendMessage } from "./telegram";

// ---------------------------------------------------------------- sozlama

type LiveKitConfig = { url: string; apiKey: string; apiSecret: string; host: string };

export function liveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  const host = process.env.LIVEKIT_API_HOST?.trim() || "http://127.0.0.1:7880";
  return { url, apiKey, apiSecret, host };
}

let rsCache: { key: string; client: RoomServiceClient } | null = null;

function roomService(): RoomServiceClient | null {
  const cfg = liveKitConfig();
  if (!cfg) return null;
  const key = `${cfg.host}|${cfg.apiKey}`;
  if (rsCache?.key !== key) rsCache = { key, client: new RoomServiceClient(cfg.host, cfg.apiKey, cfg.apiSecret) };
  return rsCache.client;
}

// ---------------------------------------------------------------- jadvallar

let ready: Promise<void> | null = null;

export function ensureConferenceSchema(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS conferences (
         id SERIAL PRIMARY KEY,
         code TEXT NOT NULL UNIQUE,
         title TEXT NOT NULL,
         description TEXT,
         host_id INT NOT NULL,
         scheduled_at TIMESTAMPTZ NOT NULL,
         duration_min INT NOT NULL DEFAULT 60,
         status TEXT NOT NULL DEFAULT 'scheduled',
         settings JSONB NOT NULL DEFAULT '{}'::jsonb,
         spotlight JSONB,
         reminded_at TIMESTAMPTZ,
         started_at TIMESTAMPTZ,
         ended_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );
       CREATE INDEX IF NOT EXISTS conferences_status_idx ON conferences (status, scheduled_at);
       CREATE TABLE IF NOT EXISTS conference_members (
         conference_id INT NOT NULL,
         user_id INT NOT NULL,
         role TEXT NOT NULL DEFAULT 'participant',
         can_speak BOOLEAN,
         invited BOOLEAN NOT NULL DEFAULT FALSE,
         banned BOOLEAN NOT NULL DEFAULT FALSE,
         notified_at TIMESTAMPTZ,
         joined_at TIMESTAMPTZ,
         last_join_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (conference_id, user_id)
       );
       CREATE INDEX IF NOT EXISTS conference_members_user_idx ON conference_members (user_id);
       CREATE TABLE IF NOT EXISTS conference_messages (
         id SERIAL PRIMARY KEY,
         conference_id INT NOT NULL,
         user_id INT NOT NULL,
         text TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );
       CREATE INDEX IF NOT EXISTS conference_messages_conf_idx ON conference_messages (conference_id, id);
       CREATE TABLE IF NOT EXISTS conference_sessions (
         id SERIAL PRIMARY KEY,
         conference_id INT NOT NULL,
         user_id INT NOT NULL,
         participant_sid TEXT,
         joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         left_at TIMESTAMPTZ
       );
       CREATE INDEX IF NOT EXISTS conference_sessions_conf_idx ON conference_sessions (conference_id, user_id);
       CREATE UNIQUE INDEX IF NOT EXISTS conference_sessions_sid_uq ON conference_sessions (participant_sid);
       ALTER TABLE conferences ADD COLUMN IF NOT EXISTS room TEXT;
       CREATE TABLE IF NOT EXISTS conference_old_codes (
         code TEXT PRIMARY KEY,
         conference_id INT NOT NULL,
         replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

// ---------------------------------------------------------------- turlar

export type SpeakMode = "all" | "selected";
export type CameraMode = "all" | "speakers";
export type ScreenMode = "all" | "speakers" | "hosts";

export type ConfSettings = {
  /** all — hamma gapira oladi; selected — faqat ruxsat berilganlar */
  speakMode: SpeakMode;
  cameraMode: CameraMode;
  screenMode: ScreenMode;
  chat: boolean;
  /** Kirganda mikrofon o‘chiq */
  muteOnJoin: boolean;
  /** Kirganda kamera o‘chiq */
  camOffOnJoin: boolean;
};

export const DEFAULT_SETTINGS: ConfSettings = {
  speakMode: "all",
  cameraMode: "all",
  screenMode: "speakers",
  chat: true,
  muteOnJoin: true,
  camOffOnJoin: false,
};

export function normalizeSettings(raw: unknown, base: ConfSettings = DEFAULT_SETTINGS): ConfSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    speakMode: pick(r.speakMode, ["all", "selected"] as const, base.speakMode),
    cameraMode: pick(r.cameraMode, ["all", "speakers"] as const, base.cameraMode),
    screenMode: pick(r.screenMode, ["all", "speakers", "hosts"] as const, base.screenMode),
    chat: bool(r.chat, base.chat),
    muteOnJoin: bool(r.muteOnJoin, base.muteOnJoin),
    camOffOnJoin: bool(r.camOffOnJoin, base.camOffOnJoin),
  };
}

export type Spotlight = { userId: number; source: "auto" | "camera" | "screen" };

export type ConfStatus = "scheduled" | "live" | "ended" | "cancelled";

export type Conference = {
  id: number;
  code: string;
  /** LiveKit xona nomi — havola yangilansa ham o‘zgarmaydi */
  room: string;
  title: string;
  description: string | null;
  hostId: number;
  scheduledAt: Date;
  durationMin: number;
  status: ConfStatus;
  settings: ConfSettings;
  spotlight: Spotlight | null;
  remindedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
};

export type MemberRole = "host" | "cohost" | "participant";

export type Member = {
  userId: number;
  role: MemberRole;
  canSpeak: boolean | null;
  invited: boolean;
  banned: boolean;
  joinedAt: Date | null;
};

function parseSpotlight(raw: unknown): Spotlight | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const userId = Number(r.userId);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const source = r.source === "camera" || r.source === "screen" ? r.source : "auto";
  return { userId, source };
}

function mapConf(r: Record<string, unknown>): Conference {
  return {
    id: r.id as number,
    code: r.code as string,
    room: (r.room as string) || roomNameFor(r.code as string),
    title: r.title as string,
    description: (r.description as string) || null,
    hostId: r.host_id as number,
    scheduledAt: new Date(r.scheduled_at as string),
    durationMin: Number(r.duration_min) || 60,
    status: r.status as ConfStatus,
    settings: normalizeSettings(r.settings),
    spotlight: parseSpotlight(r.spotlight),
    remindedAt: r.reminded_at ? new Date(r.reminded_at as string) : null,
    startedAt: r.started_at ? new Date(r.started_at as string) : null,
    endedAt: r.ended_at ? new Date(r.ended_at as string) : null,
    createdAt: new Date(r.created_at as string),
  };
}

function mapMember(r: Record<string, unknown>): Member {
  const role = r.role === "host" || r.role === "cohost" ? r.role : "participant";
  return {
    userId: r.user_id as number,
    role,
    canSpeak: typeof r.can_speak === "boolean" ? r.can_speak : null,
    invited: Boolean(r.invited),
    banned: Boolean(r.banned),
    joinedAt: r.joined_at ? new Date(r.joined_at as string) : null,
  };
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz";

/** Meet uslubidagi o‘qilishi oson kod: abc-defg-hjk */
export function newConferenceCode(): string {
  const part = (n: number) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${part(3)}-${part(4)}-${part(3)}`;
}

export const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export async function loadConference(code: string): Promise<Conference | null> {
  if (!CODE_RE.test(code)) return null;
  await ensureConferenceSchema();
  const { rows } = await pool.query(`SELECT * FROM conferences WHERE code = $1`, [code]);
  return rows[0] ? mapConf(rows[0]) : null;
}

/** Eskirgan (yangilangan) havola kodi bo‘yicha */
export async function loadConferenceByOldCode(code: string): Promise<Conference | null> {
  if (!CODE_RE.test(code)) return null;
  await ensureConferenceSchema();
  const { rows } = await pool.query(
    `SELECT c.* FROM conference_old_codes o JOIN conferences c ON c.id = o.conference_id WHERE o.code = $1`,
    [code],
  );
  return rows[0] ? mapConf(rows[0]) : null;
}

async function loadConferenceByRoom(room: string): Promise<Conference | null> {
  const { rows } = await pool.query(
    `SELECT * FROM conferences WHERE room = $1 OR (room IS NULL AND 'conf_' || code = $1) LIMIT 1`,
    [room],
  );
  return rows[0] ? mapConf(rows[0]) : null;
}

/** Yangi taklif havolasi: eski kod darhol ishlamay qoladi (xona va ichidagilar o‘zgarmaydi) */
export async function rotateConferenceCode(conf: Conference): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const next = newConferenceCode();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE conferences SET room = COALESCE(room, $3), code = $2, updated_at = NOW()
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM conferences WHERE code = $2)
            AND NOT EXISTS (SELECT 1 FROM conference_old_codes WHERE code = $2)`,
        [conf.id, next, conf.room],
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        continue;
      }
      await client.query(
        `INSERT INTO conference_old_codes (code, conference_id) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [conf.code, conf.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    conf.code = next;
    // Xonadagilar sahifa manzilini va API kodini yangilab oladi
    await sendRoomData(conf, "mod", { type: "link-changed", code: next });
    return next;
  }
  throw new Error("Yangi kod yaratib bo‘lmadi");
}

export async function loadMember(confId: number, userId: number): Promise<Member | null> {
  const { rows } = await pool.query(`SELECT * FROM conference_members WHERE conference_id = $1 AND user_id = $2`, [
    confId,
    userId,
  ]);
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function loadMembers(confId: number): Promise<Member[]> {
  const { rows } = await pool.query(`SELECT * FROM conference_members WHERE conference_id = $1`, [confId]);
  return rows.map(mapMember);
}

// ---------------------------------------------------------------- ruxsatlar

export function isModerator(member: Member | null, userRole?: string | null): boolean {
  return member?.role === "host" || member?.role === "cohost" || hasFullPlatformAccess(userRole);
}

/** Host yoki platforma admini — hammmani (shu jumladan yordamchilarni) boshqaradi */
export function isOwner(conf: Conference, userId: number, userRole?: string | null): boolean {
  return conf.hostId === userId || hasFullPlatformAccess(userRole);
}

export type Perms = {
  moderator: boolean;
  canSpeak: boolean;
  camera: boolean;
  screen: boolean;
  sources: TrackSource[];
};

export function permsFor(conf: Conference, member: Member | null, userRole?: string | null): Perms {
  const moderator = isModerator(member, userRole);
  const s = conf.settings;
  const canSpeak = moderator || (member?.canSpeak ?? s.speakMode === "all");
  const camera = moderator || s.cameraMode === "all" || canSpeak;
  const screen = moderator || s.screenMode === "all" || (s.screenMode === "speakers" && canSpeak);
  const sources: TrackSource[] = [];
  if (canSpeak) sources.push(TrackSource.MICROPHONE);
  if (camera) sources.push(TrackSource.CAMERA);
  if (screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  return { moderator, canSpeak, camera, screen, sources };
}

function displayRole(conf: Conference, userId: number, member: Member | null, userRole?: string | null): MemberRole {
  if (conf.hostId === userId || member?.role === "host") return "host";
  return isModerator(member, userRole) ? "cohost" : "participant";
}

export function identityFor(userId: number): string {
  return `u${userId}`;
}

export function userIdFromIdentity(identity: string): number | null {
  const m = /^u(\d+)$/.exec(identity);
  return m ? Number(m[1]) : null;
}

export function roomNameFor(code: string): string {
  return `conf_${code}`;
}

/** Hamma ko‘radigan xona holati: asosiy ekran va sozlamalar */
function roomMetadata(conf: Conference): string {
  return JSON.stringify({ title: conf.title, hostId: conf.hostId, spotlight: conf.spotlight, settings: conf.settings });
}

const EARLY_JOIN_MS = 10 * 60_000;

export type JoinState = { joinable: boolean; reason: null | "ended" | "cancelled" | "early" | "banned" };

export function joinState(conf: Conference, member: Member | null, moderator: boolean): JoinState {
  if (conf.status === "ended") return { joinable: false, reason: "ended" };
  if (conf.status === "cancelled") return { joinable: false, reason: "cancelled" };
  if (member?.banned && !moderator) return { joinable: false, reason: "banned" };
  if (moderator || conf.status === "live") return { joinable: true, reason: null };
  if (Date.now() >= conf.scheduledAt.getTime() - EARLY_JOIN_MS) return { joinable: true, reason: null };
  return { joinable: false, reason: "early" };
}

// ---------------------------------------------------------------- LiveKit bilan ishlash

/** Xona nomi → ichidagilar soni. null — LiveKit javob bermadi (xona holati noma’lum) */
export async function liveCounts(roomNames: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  const rs = roomService();
  if (!rs) return null;
  if (!roomNames.length) return out;
  try {
    const rooms = await rs.listRooms(roomNames);
    for (const room of rooms) out.set(room.name, room.numParticipants);
    return out;
  } catch (err) {
    logger.warn({ err }, "conference listRooms");
    return null;
  }
}

async function ensureRoom(conf: Conference): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  const metadata = roomMetadata(conf);
  const room = await rs.createRoom({
    name: conf.room,
    emptyTimeout: 15 * 60,
    departureTimeout: 60,
    maxParticipants: 150,
    metadata,
  });
  if (room.metadata !== metadata) await rs.updateRoomMetadata(room.name, metadata);
}

async function pushRoomMetadata(conf: Conference): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  try {
    await rs.updateRoomMetadata(conf.room, roomMetadata(conf));
  } catch {
    /* xona hali ochilmagan — keyingi kirishda yoziladi */
  }
}

async function roomParticipants(conf: Conference): Promise<ParticipantInfo[]> {
  const rs = roomService();
  if (!rs) return [];
  try {
    return await rs.listParticipants(conf.room);
  } catch {
    return [];
  }
}

async function userRoles(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const { rows } = await pool.query(`SELECT id, role FROM users WHERE id = ANY($1::int[])`, [ids]);
  for (const r of rows) out.set(r.id as number, (r.role as string) || "");
  return out;
}

function grantFor(perms: Perms) {
  return {
    canSubscribe: true,
    canPublishData: true,
    canPublish: perms.sources.length > 0,
    // Bo‘sh ro‘yxat LiveKit'da «hammasi mumkin» degani — shuning uchun canPublish bilan birga
    canPublishSources: perms.sources,
  };
}

/** Sozlama yoki a’zo o‘zgarganda xonadagi har bir ishtirokchining ruxsatini qayta hisoblaydi */
export async function applyLivePerms(conf: Conference, onlyUserIds?: number[]): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  const parts = await roomParticipants(conf);
  const targets = parts
    .map((p) => ({ p, uid: userIdFromIdentity(p.identity) }))
    .filter((x): x is { p: ParticipantInfo; uid: number } => x.uid != null && (!onlyUserIds || onlyUserIds.includes(x.uid)));
  if (!targets.length) return;
  const members = new Map((await loadMembers(conf.id)).map((m) => [m.userId, m]));
  const roles = await userRoles(targets.map((t) => t.uid));
  const room = conf.room;
  await Promise.all(
    targets.map(async ({ p, uid }) => {
      const member = members.get(uid) ?? null;
      const perms = permsFor(conf, member, roles.get(uid));
      try {
        await rs.updateParticipant(room, p.identity, {
          attributes: {
            role: displayRole(conf, uid, member, roles.get(uid)),
            speak: perms.canSpeak ? "1" : "0",
          },
          permission: grantFor(perms),
        });
        if (!perms.canSpeak) await muteSources(conf, p, [TrackSource.MICROPHONE]);
      } catch (err) {
        logger.warn({ err, uid, code: conf.code }, "conference updateParticipant");
      }
    }),
  );
}

async function muteSources(conf: Conference, p: ParticipantInfo, sources: TrackSource[]): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  const room = conf.room;
  for (const t of p.tracks) {
    if (!sources.includes(t.source) || t.muted) continue;
    try {
      await rs.mutePublishedTrack(room, p.identity, t.sid, true);
    } catch (err) {
      logger.warn({ err, code: conf.code }, "conference mutePublishedTrack");
    }
  }
}

async function participantOf(conf: Conference, userId: number): Promise<ParticipantInfo | null> {
  const rs = roomService();
  if (!rs) return null;
  try {
    return await rs.getParticipant(conf.room, identityFor(userId));
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();

/** Serverdan xabar: mijoz faqat jo‘natuvchisi yo‘q (server) xabarlarni moderatsiya deb qabul qiladi */
async function sendRoomData(conf: Conference, topic: string, payload: unknown, userIds?: number[]): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  if (userIds && !userIds.length) return;
  try {
    await rs.sendData(conf.room, encoder.encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, {
      topic,
      destinationIdentities: userIds?.map(identityFor),
    });
  } catch (err) {
    logger.warn({ err, code: conf.code, topic }, "conference sendData");
  }
}

// ---------------------------------------------------------------- kirish

export type JoinTicket = { url: string; token: string; identity: string };

export async function issueJoinToken(
  conf: Conference,
  user: { id: number; fullName: string; role: string },
): Promise<JoinTicket | null> {
  const cfg = liveKitConfig();
  if (!cfg) return null;
  const { rows } = await pool.query(
    `INSERT INTO conference_members (conference_id, user_id, role, joined_at, last_join_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (conference_id, user_id)
     DO UPDATE SET joined_at = COALESCE(conference_members.joined_at, NOW()), last_join_at = NOW()
     RETURNING *`,
    [conf.id, user.id, conf.hostId === user.id ? "host" : "participant"],
  );
  const member = mapMember(rows[0]);
  if (conf.status === "scheduled") {
    await pool.query(
      `UPDATE conferences SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = 'scheduled'`,
      [conf.id],
    );
    conf.status = "live";
  }
  await ensureRoom(conf);
  const perms = permsFor(conf, member, user.role);
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: identityFor(user.id),
    name: user.fullName,
    ttl: "8h",
    attributes: {
      uid: String(user.id),
      role: displayRole(conf, user.id, member, user.role),
      speak: perms.canSpeak ? "1" : "0",
    },
  });
  at.addGrant({ roomJoin: true, room: conf.room, canUpdateOwnMetadata: false, ...grantFor(perms) });
  return { url: cfg.url, token: await at.toJwt(), identity: identityFor(user.id) };
}

// ---------------------------------------------------------------- moderatsiya

export type ModAction =
  | "mute"
  | "unmute"
  | "camera-off"
  | "screen-off"
  | "allow-speak"
  | "revoke-speak"
  | "lower-hand"
  | "kick"
  | "unban"
  | "make-cohost"
  | "remove-cohost";

export const MOD_ACTIONS: readonly ModAction[] = [
  "mute",
  "unmute",
  "camera-off",
  "screen-off",
  "allow-speak",
  "revoke-speak",
  "lower-hand",
  "kick",
  "unban",
  "make-cohost",
  "remove-cohost",
];

async function setMember(confId: number, userId: number, patch: { canSpeak?: boolean | null; role?: MemberRole; banned?: boolean }) {
  const sets: string[] = [];
  const params: unknown[] = [confId, userId];
  if (patch.canSpeak !== undefined) {
    params.push(patch.canSpeak);
    sets.push(`can_speak = $${params.length}`);
  }
  if (patch.role) {
    params.push(patch.role);
    sets.push(`role = $${params.length}`);
  }
  if (patch.banned !== undefined) {
    params.push(patch.banned);
    sets.push(`banned = $${params.length}`);
  }
  if (!sets.length) return;
  await pool.query(
    `INSERT INTO conference_members (conference_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
    [confId, userId],
  );
  await pool.query(`UPDATE conference_members SET ${sets.join(", ")} WHERE conference_id = $1 AND user_id = $2`, params);
}

async function setHand(conf: Conference, userId: number, raised: boolean): Promise<void> {
  const rs = roomService();
  if (!rs) return;
  try {
    await rs.updateParticipant(conf.room, identityFor(userId), {
      attributes: { hand: raised ? String(Date.now()) : "" },
    });
  } catch {
    /* ishtirokchi xonada emas */
  }
}

export async function raiseHand(conf: Conference, userId: number, raised: boolean): Promise<void> {
  await setHand(conf, userId, raised);
}

export type ModResult = { ok: true } | { ok: false; status: number; error: string };

export async function moderate(
  conf: Conference,
  actor: { id: number; role: string },
  targetId: number,
  action: ModAction,
): Promise<ModResult> {
  const actorMember = await loadMember(conf.id, actor.id);
  if (!isModerator(actorMember, actor.role) && conf.hostId !== actor.id) {
    return { ok: false, status: 403, error: "Faqat tashkilotchi boshqaradi" };
  }
  const owner = isOwner(conf, actor.id, actor.role);
  if (targetId === actor.id && action !== "lower-hand") {
    return { ok: false, status: 400, error: "O‘zingizga qo‘llab bo‘lmaydi" };
  }
  if (targetId === conf.hostId && !hasFullPlatformAccess(actor.role)) {
    return { ok: false, status: 403, error: "Tashkilotchini boshqarib bo‘lmaydi" };
  }
  const target = await loadMember(conf.id, targetId);
  const targetRoles = await userRoles([targetId]);
  const targetIsMod = isModerator(target, targetRoles.get(targetId)) || targetId === conf.hostId;
  if (targetIsMod && !owner && action !== "lower-hand") {
    return { ok: false, status: 403, error: "Yordamchi tashkilotchini faqat asosiy tashkilotchi boshqaradi" };
  }
  if ((action === "make-cohost" || action === "remove-cohost") && !owner) {
    return { ok: false, status: 403, error: "Faqat asosiy tashkilotchi yordamchi tayinlaydi" };
  }

  const p = await participantOf(conf, targetId);
  switch (action) {
    case "mute":
      if (p) await muteSources(conf, p, [TrackSource.MICROPHONE]);
      await sendRoomData(conf, "mod", { type: "mute" }, [targetId]);
      break;
    case "unmute":
      if (!permsFor(conf, target, targetRoles.get(targetId)).canSpeak) {
        await setMember(conf.id, targetId, { canSpeak: true });
        await applyLivePerms(conf, [targetId]);
      }
      await setHand(conf, targetId, false);
      await sendRoomData(conf, "mod", { type: "unmute" }, [targetId]);
      break;
    case "camera-off":
      if (p) await muteSources(conf, p, [TrackSource.CAMERA]);
      await sendRoomData(conf, "mod", { type: "camera-off" }, [targetId]);
      break;
    case "screen-off":
      if (p) await muteSources(conf, p, [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
      await sendRoomData(conf, "mod", { type: "screen-off" }, [targetId]);
      break;
    case "allow-speak":
      await setMember(conf.id, targetId, { canSpeak: true });
      await applyLivePerms(conf, [targetId]);
      await setHand(conf, targetId, false);
      await sendRoomData(conf, "mod", { type: "speak-granted" }, [targetId]);
      break;
    case "revoke-speak":
      await setMember(conf.id, targetId, { canSpeak: false });
      await applyLivePerms(conf, [targetId]);
      await sendRoomData(conf, "mod", { type: "speak-revoked" }, [targetId]);
      break;
    case "lower-hand":
      await setHand(conf, targetId, false);
      break;
    case "kick": {
      await setMember(conf.id, targetId, { banned: true });
      await sendRoomData(conf, "mod", { type: "kicked" }, [targetId]);
      const rs = roomService();
      if (rs && p) {
        try {
          await rs.removeParticipant(conf.room, identityFor(targetId));
        } catch (err) {
          logger.warn({ err, code: conf.code }, "conference removeParticipant");
        }
      }
      break;
    }
    case "unban":
      await setMember(conf.id, targetId, { banned: false });
      break;
    case "make-cohost":
      await setMember(conf.id, targetId, { role: "cohost" });
      await applyLivePerms(conf, [targetId]);
      await sendRoomData(conf, "mod", { type: "cohost-granted" }, [targetId]);
      break;
    case "remove-cohost":
      await setMember(conf.id, targetId, { role: "participant" });
      await applyLivePerms(conf, [targetId]);
      break;
  }
  return { ok: true };
}

/** Tashkilotchilardan boshqa hammaning mikrofonini o‘chiradi */
export async function muteAll(conf: Conference): Promise<number> {
  const parts = await roomParticipants(conf);
  const members = new Map((await loadMembers(conf.id)).map((m) => [m.userId, m]));
  const uids = parts.map((p) => userIdFromIdentity(p.identity)).filter((x): x is number => x != null);
  const roles = await userRoles(uids);
  const targets: number[] = [];
  for (const p of parts) {
    const uid = userIdFromIdentity(p.identity);
    if (uid == null || uid === conf.hostId) continue;
    if (isModerator(members.get(uid) ?? null, roles.get(uid))) continue;
    targets.push(uid);
    await muteSources(conf, p, [TrackSource.MICROPHONE]);
  }
  await sendRoomData(conf, "mod", { type: "mute" }, targets);
  return targets.length;
}

export async function updateSettings(conf: Conference, settings: ConfSettings): Promise<void> {
  await pool.query(`UPDATE conferences SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
    conf.id,
    JSON.stringify(settings),
  ]);
  conf.settings = settings;
  await pushRoomMetadata(conf);
  await applyLivePerms(conf);
}

export async function setSpotlight(conf: Conference, spotlight: Spotlight | null): Promise<void> {
  await pool.query(`UPDATE conferences SET spotlight = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
    conf.id,
    spotlight ? JSON.stringify(spotlight) : null,
  ]);
  conf.spotlight = spotlight;
  await pushRoomMetadata(conf);
}

export async function endConference(conf: Conference, status: "ended" | "cancelled" = "ended"): Promise<void> {
  await pool.query(
    `UPDATE conferences SET status = $2, ended_at = COALESCE(ended_at, NOW()), spotlight = NULL, updated_at = NOW() WHERE id = $1`,
    [conf.id, status],
  );
  conf.status = status;
  await closeOpenSessions(conf.id);
  const rs = roomService();
  if (!rs) return;
  await sendRoomData(conf, "mod", { type: "ended" });
  try {
    await rs.deleteRoom(conf.room);
  } catch {
    /* xona allaqachon yopilgan */
  }
}

// ---------------------------------------------------------------- chat

export type ChatMessage = { id: number; userId: number; name: string; text: string; at: string };

export async function listMessages(confId: number): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.user_id, m.text, m.created_at, u.full_name
       FROM (SELECT * FROM conference_messages WHERE conference_id = $1 ORDER BY id DESC LIMIT 300) m
       LEFT JOIN users u ON u.id = m.user_id
      ORDER BY m.id`,
    [confId],
  );
  return rows.map((r) => ({
    id: r.id as number,
    userId: r.user_id as number,
    name: (r.full_name as string) || "—",
    text: r.text as string,
    at: new Date(r.created_at).toISOString(),
  }));
}

export async function postMessage(conf: Conference, user: { id: number; fullName: string }, text: string): Promise<ChatMessage> {
  const { rows } = await pool.query(
    `INSERT INTO conference_messages (conference_id, user_id, text) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [conf.id, user.id, text],
  );
  const msg: ChatMessage = {
    id: rows[0].id as number,
    userId: user.id,
    name: user.fullName,
    text,
    at: new Date(rows[0].created_at).toISOString(),
  };
  await sendRoomData(conf, "chat", msg);
  return msg;
}

// ---------------------------------------------------------------- qatnashuv (kim qachon kirdi/chiqdi)

async function closeOpenSessions(confId: number): Promise<void> {
  await pool.query(`UPDATE conference_sessions SET left_at = NOW() WHERE conference_id = $1 AND left_at IS NULL`, [confId]);
}

function tsFromSeconds(v: unknown): Date | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 1_000_000_000 ? new Date(n * 1000) : null;
}

let webhookReceiver: { key: string; receiver: WebhookReceiver } | null = null;

/** LiveKit webhook: participant_joined / participant_left / room_finished — imzo tekshiriladi */
export async function handleLiveKitWebhook(body: string, authHeader: string | undefined): Promise<void> {
  const cfg = liveKitConfig();
  if (!cfg) throw new Error("LiveKit sozlanmagan");
  const key = `${cfg.apiKey}|${cfg.apiSecret}`;
  if (webhookReceiver?.key !== key) webhookReceiver = { key, receiver: new WebhookReceiver(cfg.apiKey, cfg.apiSecret) };
  const event = await webhookReceiver.receiver.receive(body, authHeader);
  const roomName = event.room?.name ?? "";
  if (!roomName.startsWith("conf_")) return;
  await ensureConferenceSchema();
  const conf = await loadConferenceByRoom(roomName);
  if (!conf) return;
  const at = tsFromSeconds(event.createdAt) ?? new Date();

  if (event.event === "room_finished") {
    await pool.query(
      `UPDATE conference_sessions SET left_at = $2 WHERE conference_id = $1 AND left_at IS NULL`,
      [conf.id, at],
    );
    return;
  }
  const p = event.participant;
  const uid = p ? userIdFromIdentity(p.identity) : null;
  if (!p || uid == null) return;
  if (event.event === "participant_joined") {
    const joined = tsFromSeconds(p.joinedAt) ?? at;
    await pool.query(
      `INSERT INTO conference_sessions (conference_id, user_id, participant_sid, joined_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (participant_sid) DO NOTHING`,
      [conf.id, uid, p.sid, joined],
    );
    return;
  }
  if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
    const { rowCount } = await pool.query(
      `UPDATE conference_sessions SET left_at = $2 WHERE participant_sid = $1 AND left_at IS NULL`,
      [p.sid, at],
    );
    if (!rowCount) {
      const joined = tsFromSeconds(p.joinedAt);
      if (joined) {
        await pool.query(
          `INSERT INTO conference_sessions (conference_id, user_id, participant_sid, joined_at, left_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (participant_sid) DO NOTHING`,
          [conf.id, uid, p.sid, joined, at],
        );
      }
    }
  }
}

export type AttendanceRow = {
  userId: number;
  fullName: string;
  position: string | null;
  role: MemberRole;
  invited: boolean;
  firstJoin: string | null;
  lastLeave: string | null;
  seconds: number;
  sessions: number;
};

export type ConferenceHistory = {
  actualStart: string | null;
  actualEnd: string | null;
  actualSeconds: number;
  invitedCount: number;
  attendedCount: number;
  attendance: AttendanceRow[];
  messages: ChatMessage[];
};

/** Yakunlangan (yoki davom etayotgan) konferensiya tarixi: qatnashuv va to‘liq chat */
export async function conferenceHistory(conf: Conference): Promise<ConferenceHistory> {
  const [{ rows: att }, { rows: msgs }] = await Promise.all([
    pool.query(
      `WITH s AS (
         SELECT user_id,
                MIN(joined_at) AS first_join,
                MAX(COALESCE(left_at, NOW())) AS last_leave,
                SUM(EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at)))::int AS seconds,
                COUNT(*)::int AS sessions
           FROM conference_sessions WHERE conference_id = $1 GROUP BY user_id
       )
       SELECT COALESCE(m.user_id, s.user_id) AS user_id, u.full_name, e.position,
              COALESCE(m.role, 'participant') AS role, COALESCE(m.invited, FALSE) AS invited,
              COALESCE(s.first_join, m.joined_at) AS first_join,
              COALESCE(s.last_leave, m.last_join_at) AS last_leave,
              COALESCE(s.seconds, 0) AS seconds, COALESCE(s.sessions, CASE WHEN m.joined_at IS NOT NULL THEN 1 ELSE 0 END) AS sessions
         FROM (SELECT * FROM conference_members WHERE conference_id = $1) m
         FULL OUTER JOIN s ON s.user_id = m.user_id
         LEFT JOIN users u ON u.id = COALESCE(m.user_id, s.user_id)
         LEFT JOIN LATERAL (SELECT position FROM employees WHERE user_id = u.id ORDER BY id DESC LIMIT 1) e ON TRUE
        ORDER BY COALESCE(s.seconds, 0) DESC, u.full_name`,
      [conf.id],
    ),
    pool.query(
      `SELECT m.id, m.user_id, m.text, m.created_at, u.full_name
         FROM conference_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.conference_id = $1 ORDER BY m.id LIMIT 5000`,
      [conf.id],
    ),
  ]);
  const attendance: AttendanceRow[] = att.map((r) => ({
    userId: r.user_id as number,
    fullName: (r.full_name as string) || "—",
    position: (r.position as string) || null,
    role: ((r.role as string) === "host" || r.user_id === conf.hostId ? "host" : (r.role as MemberRole)) || "participant",
    invited: Boolean(r.invited),
    firstJoin: r.first_join ? new Date(r.first_join).toISOString() : null,
    lastLeave: r.last_leave ? new Date(r.last_leave).toISOString() : null,
    seconds: Math.max(0, Number(r.seconds) || 0),
    sessions: Number(r.sessions) || 0,
  }));
  const joined = attendance.filter((a) => a.firstJoin);
  const firstJoin = joined.reduce<number | null>((min, a) => {
    const t = new Date(a.firstJoin!).getTime();
    return min == null || t < min ? t : min;
  }, null);
  const start = firstJoin ?? conf.startedAt?.getTime() ?? null;
  const lastLeave = joined.reduce<number | null>((max, a) => {
    const t = a.lastLeave ? new Date(a.lastLeave).getTime() : null;
    return t != null && (max == null || t > max) ? t : max;
  }, null);
  const end = conf.endedAt?.getTime() ?? (conf.status === "live" ? Date.now() : lastLeave);
  return {
    actualStart: start ? new Date(start).toISOString() : null,
    actualEnd: end ? new Date(end).toISOString() : null,
    actualSeconds: start && end && end > start ? Math.round((end - start) / 1000) : 0,
    invitedCount: attendance.filter((a) => a.invited).length,
    attendedCount: joined.length,
    attendance,
    messages: msgs.map((r) => ({
      id: r.id as number,
      userId: r.user_id as number,
      name: (r.full_name as string) || "—",
      text: r.text as string,
      at: new Date(r.created_at).toISOString(),
    })),
  };
}

/** Konferensiyani va butun tarixini o‘chirish (davom etayotgan bo‘lsa avval yakunlanadi) */
export async function deleteConference(conf: Conference): Promise<void> {
  if (conf.status === "live") await endConference(conf, "ended");
  await pool.query(`DELETE FROM conference_sessions WHERE conference_id = $1`, [conf.id]);
  await pool.query(`DELETE FROM conference_messages WHERE conference_id = $1`, [conf.id]);
  await pool.query(`DELETE FROM conference_members WHERE conference_id = $1`, [conf.id]);
  await pool.query(`DELETE FROM conference_old_codes WHERE conference_id = $1`, [conf.id]);
  await pool.query(`DELETE FROM conferences WHERE id = $1`, [conf.id]);
}

// ---------------------------------------------------------------- bildirishnomalar

export function conferencePath(code: string): string {
  return `/konferensiya/${code}`;
}

export function conferenceUrl(code: string): string {
  const base = publicAppUrl();
  return base ? `${base}${conferencePath(code)}` : conferencePath(code);
}

export function whenUz(d: Date): string {
  return d.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type NotifyKind = "invite" | "reminder" | "started" | "updated" | "cancelled" | "link";

function notifyText(conf: Conference, kind: NotifyKind, hostName: string): { title: string; body: string } {
  const when = whenUz(conf.scheduledAt);
  switch (kind) {
    case "invite":
      return {
        title: "Konferensiyaga taklif",
        body: `📹 Sizni «${conf.title}» konferensiyasiga taklif qilishdi.\n🗓 ${when} (${conf.durationMin} daqiqa)\n👤 Tashkilotchi: ${hostName}\n\nBelgilangan vaqtda havola orqali kiring.`,
      };
    case "reminder":
      return {
        title: "Konferensiya boshlanmoqda",
        body: `⏰ «${conf.title}» konferensiyasi boshlanmoqda (${when}).\n👤 Tashkilotchi: ${hostName}\n\nHozir havola orqali kiring.`,
      };
    case "started":
      return {
        title: "Konferensiya boshlandi",
        body: `🟢 «${conf.title}» konferensiyasi boshlandi.\n👤 Tashkilotchi: ${hostName}\n\nHavola orqali kiring.`,
      };
    case "updated":
      return {
        title: "Konferensiya vaqti o‘zgardi",
        body: `🔄 «${conf.title}» konferensiyasi yangilandi.\n🗓 Yangi vaqt: ${when} (${conf.durationMin} daqiqa)\n👤 Tashkilotchi: ${hostName}`,
      };
    case "cancelled":
      return {
        title: "Konferensiya bekor qilindi",
        body: `❌ «${conf.title}» konferensiyasi (${when}) bekor qilindi.\n👤 Tashkilotchi: ${hostName}`,
      };
    case "link":
      return {
        title: "Konferensiya havolasi yangilandi",
        body: `🔗 «${conf.title}» konferensiyasi uchun yangi havola.\n🗓 ${when}\n👤 Tashkilotchi: ${hostName}\n\nEski havola endi ishlamaydi — faqat shu yangi havola orqali kiring.`,
      };
  }
}

/** Tizim xabari + push + Telegram (brauzerda ochiladigan «Kirish» tugmasi bilan) */
export async function notifyConferenceUsers(conf: Conference, userIds: number[], kind: NotifyKind): Promise<void> {
  const ids = [...new Set(userIds)].filter((id) => id > 0);
  if (!ids.length) return;
  const { rows: hostRows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [conf.hostId]);
  const hostName = (hostRows[0]?.full_name as string) || "Admin";
  const { title, body } = notifyText(conf, kind, hostName);
  const url = conferenceUrl(conf.code);
  const canJoin = kind !== "cancelled";
  const tgIds = new Map<number, string>();
  if (isTelegramConfigured()) {
    const { rows } = await pool.query(
      `SELECT id, telegram_id FROM users WHERE id = ANY($1::int[]) AND telegram_id IS NOT NULL AND status <> 'terminated'`,
      [ids],
    );
    for (const r of rows) tgIds.set(r.id as number, String(r.telegram_id));
  }
  for (const userId of ids) {
    try {
      await notifyUser({ userId, text: body, type: "conference", linkUrl: conferencePath(conf.code), telegram: false, title });
    } catch (err) {
      logger.warn({ err, userId }, "conference notify");
    }
    const chatId = tgIds.get(userId);
    if (!chatId) continue;
    const absolute = /^https?:\/\//.test(url);
    try {
      await sendMessage(
        chatId,
        `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}${canJoin && !absolute ? `\n\n🔗 ${escapeHtml(url)}` : ""}`,
        canJoin && absolute ? { reply_markup: { inline_keyboard: [[{ text: "🎥 Konferensiyaga kirish", url }]] } } : undefined,
      );
    } catch (err) {
      logger.warn({ err, userId }, "conference telegram");
    }
  }
  if (kind === "invite" || kind === "updated" || kind === "link") {
    await pool.query(
      `UPDATE conference_members SET notified_at = NOW() WHERE conference_id = $1 AND user_id = ANY($2::int[])`,
      [conf.id, ids],
    );
  }
}

export async function invitedUserIds(confId: number, opts?: { excludeUserId?: number }): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT user_id FROM conference_members WHERE conference_id = $1 AND (invited OR role IN ('host','cohost')) AND NOT banned`,
    [confId],
  );
  return rows.map((r) => r.user_id as number).filter((id) => id !== opts?.excludeUserId);
}

// ---------------------------------------------------------------- fon ishi

/** Boshlanish eslatmasi va unutilgan konferensiyalarni yopish */
export async function conferenceTick(): Promise<void> {
  await ensureConferenceSchema();
  const { rows: due } = await pool.query(
    `UPDATE conferences SET reminded_at = NOW()
      WHERE status IN ('scheduled','live') AND reminded_at IS NULL
        AND scheduled_at <= NOW() + INTERVAL '5 minutes'
        AND scheduled_at >= NOW() - INTERVAL '30 minutes'
      RETURNING *`,
  );
  for (const r of due) {
    const conf = mapConf(r);
    const ids = await invitedUserIds(conf.id);
    await notifyConferenceUsers(conf, ids, "reminder").catch((err) => logger.warn({ err }, "conference reminder"));
  }

  const { rows: stale } = await pool.query(
    `SELECT * FROM conferences
      WHERE (status = 'live' AND scheduled_at + make_interval(mins => duration_min) < NOW() - INTERVAL '15 minutes')
         OR (status = 'scheduled' AND scheduled_at + make_interval(mins => duration_min) < NOW() - INTERVAL '2 hours')`,
  );
  // Webhook kelmay qolgan bo‘lsa — yopilgan konferensiyadagi ochiq sessiyalarni yopamiz
  await pool.query(
    `UPDATE conference_sessions s SET left_at = GREATEST(s.joined_at, COALESCE(c.ended_at, NOW()))
       FROM conferences c
      WHERE c.id = s.conference_id AND s.left_at IS NULL AND c.status IN ('ended','cancelled')`,
  );
  if (!stale.length) return;
  const confs = stale.map(mapConf);
  const live = confs.filter((c) => c.status === "live");
  const counts = live.length ? await liveCounts(live.map((c) => c.room)) : new Map<string, number>();
  for (const conf of confs) {
    if (conf.status === "live" && (!counts || (counts.get(conf.room) ?? 0) > 0)) continue;
    await endConference(conf, "ended");
  }
}
