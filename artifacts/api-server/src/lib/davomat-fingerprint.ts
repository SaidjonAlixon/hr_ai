import type { Request, Response } from "express";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db, davomatFingerprintsTable, usersTable, webauthnChallengesTable } from "@workspace/db";
import { rpFromRequest, webauthnUnsupportedHostMessage } from "./webauthn-rp";
import { clientIp, randomToken, sha256 } from "./device-security";
import { isProdEnv } from "./session";

/** Shu brauzer/qurilmaga yoziladigan maxfiy kalit — barmoq izi faqat shu qurilmada ishlaydi. */
export const FINGER_DEVICE_COOKIE = "fp_bind";
const FINGER_DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60 * 1000;
const REGISTER_TTL_MS = 3 * 60 * 1000;
const PUNCH_TTL_MS = 2 * 60 * 1000;
/** Ro‘yxatdan o‘tish barmoq bilan tasdiqlangan — shu zahoti 1 marta Keldim/Ketdim uchun */
const ENROLL_PASS_TTL_MS = 2 * 60 * 1000;

type ChallengeKind = "fp_register" | "fp_punch" | "fp_enroll_pass";
type Fail = { ok: false; status: number; body: { error: string; code: string } };

function fail(status: number, code: string, error: string): Fail {
  return { ok: false, status, body: { error, code } };
}

function readDeviceKey(req: Request): string | null {
  const raw = req.cookies?.[FINGER_DEVICE_COOKIE];
  return typeof raw === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(raw) ? raw : null;
}

function setDeviceKey(res: Response, key: string) {
  res.cookie(FINGER_DEVICE_COOKIE, key, {
    httpOnly: true,
    secure: isProdEnv(),
    sameSite: "lax",
    path: "/",
    maxAge: FINGER_DEVICE_COOKIE_MAX_AGE,
  });
}

export function deviceLabelFromUa(ua: string): string {
  const s = ua || "";
  const android = /Android\s([\d.]+)/i.exec(s);
  let os = "Noma’lum qurilma";
  if (/iPhone/i.test(s)) os = "iPhone";
  else if (/iPad/i.test(s)) os = "iPad";
  else if (android) {
    const model = /Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/i.exec(s)?.[1]?.trim();
    os = model && !/^(K|wv|Linux)$/i.test(model) ? `Android · ${model}` : `Android ${android[1]}`;
  } else if (/Windows/i.test(s)) os = "Windows kompyuter";
  else if (/Macintosh|Mac OS X/i.test(s)) os = "Mac kompyuter";
  else if (/Linux/i.test(s)) os = "Linux kompyuter";
  const browser = /EdgA?\//.test(s)
    ? "Edge"
    : /YaBrowser/.test(s)
      ? "Yandex"
      : /SamsungBrowser/.test(s)
        ? "Samsung"
        : /CriOS|Chrome\//.test(s)
          ? "Chrome"
          : /FxiOS|Firefox\//.test(s)
            ? "Firefox"
            : /Safari\//.test(s)
              ? "Safari"
              : "";
  return browser ? `${os} · ${browser}` : os;
}

async function saveChallenge(kind: ChallengeKind, challenge: string, userId: number, ttlMs: number) {
  await db
    .delete(webauthnChallengesTable)
    .where(and(eq(webauthnChallengesTable.userId, userId), eq(webauthnChallengesTable.kind, kind)));
  await db.insert(webauthnChallengesTable).values({
    userId,
    challenge,
    kind,
    expiresAt: new Date(Date.now() + ttlMs),
  });
}

/** Bir martalik: olingan zahoti o‘chadi (takroriy yuborishga yo‘l yo‘q). */
async function takeChallenge(clientDataJSON: string, kind: ChallengeKind, userId: number) {
  let challenge = "";
  let type = "";
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as {
      challenge?: string;
      type?: string;
    };
    challenge = String(parsed.challenge || "");
    type = String(parsed.type || "");
  } catch {
    return null;
  }
  if (!challenge) return null;
  const now = new Date();
  const [row] = await db
    .select()
    .from(webauthnChallengesTable)
    .where(
      and(
        eq(webauthnChallengesTable.challenge, challenge),
        eq(webauthnChallengesTable.kind, kind),
        eq(webauthnChallengesTable.userId, userId),
        gt(webauthnChallengesTable.expiresAt, now),
      ),
    )
    .limit(1);
  if (row) await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, row.id));
  void db
    .delete(webauthnChallengesTable)
    .where(lt(webauthnChallengesTable.expiresAt, now))
    .catch(() => undefined);
  if (!row) return null;
  const expectedType = kind === "fp_register" ? "webauthn.create" : "webauthn.get";
  if (type !== expectedType) return null;
  return challenge;
}

function userIdBytes(id: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint32(0, 0x46505631, false);
  new DataView(bytes.buffer).setUint32(4, id, false);
  return bytes;
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr.filter((t) => typeof t === "string") as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
}

function rpOrFail(req: Request): { rpID: string; origin: string; rpName: string } | Fail {
  const rp = rpFromRequest(req);
  const hostErr = webauthnUnsupportedHostMessage(rp.rpID);
  if (hostErr) return fail(400, "finger_host", "Barmoq izi faqat sayt domeni orqali ishlaydi (IP manzilda emas).");
  return rp;
}

export async function getFingerprintEnrollment(userId: number) {
  const [row] = await db
    .select()
    .from(davomatFingerprintsTable)
    .where(eq(davomatFingerprintsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export type FingerprintPublicInfo = {
  enrolled: boolean;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  deviceLabel: string | null;
  useCount: number;
};

export async function fingerprintInfoByUser(userIds: number[]): Promise<Map<number, FingerprintPublicInfo>> {
  const map = new Map<number, FingerprintPublicInfo>();
  if (!userIds.length) return map;
  const rows = await db
    .select({
      userId: davomatFingerprintsTable.userId,
      createdAt: davomatFingerprintsTable.createdAt,
      lastUsedAt: davomatFingerprintsTable.lastUsedAt,
      deviceLabel: davomatFingerprintsTable.deviceLabel,
      useCount: davomatFingerprintsTable.useCount,
    })
    .from(davomatFingerprintsTable)
    .where(inArray(davomatFingerprintsTable.userId, userIds));
  for (const r of rows) {
    map.set(r.userId, {
      enrolled: true,
      enrolledAt: r.createdAt ? r.createdAt.toISOString() : null,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      deviceLabel: r.deviceLabel,
      useCount: r.useCount ?? 0,
    });
  }
  return map;
}

/** Xodim ekrani uchun: ro‘yxatdan o‘tganmi va aynan shu qurilmami. */
export async function fingerprintStatusFor(req: Request, userId: number) {
  const row = await getFingerprintEnrollment(userId);
  const key = readDeviceKey(req);
  const thisDevice = Boolean(row && key && sha256(key) === row.deviceKeyHash);
  return {
    enrolled: Boolean(row),
    thisDevice,
    deviceLabel: row?.deviceLabel ?? null,
    enrolledAt: row?.createdAt ? row.createdAt.toISOString() : null,
    lastUsedAt: row?.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

const ALREADY_ENROLLED =
  "Barmoq izingiz allaqachon ro‘yxatdan o‘tgan. Qayta o‘tkazish faqat admin ruxsati bilan (Bloklash oynasidan tiklanadi).";
const DEVICE_TAKEN =
  "Bu qurilma boshqa xodimning barmoq iziga biriktirilgan. Har bir xodim faqat o‘z telefonidan ro‘yxatdan o‘tadi.";

export async function fingerprintRegisterOptions(req: Request, userId: number) {
  const rp = rpOrFail(req);
  if ("ok" in rp) return rp;
  const [user] = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, login: usersTable.login })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return fail(404, "user_not_found", "Foydalanuvchi topilmadi");
  if (await getFingerprintEnrollment(userId)) return fail(409, "finger_already_enrolled", ALREADY_ENROLLED);

  const key = readDeviceKey(req);
  if (key) {
    const [taken] = await db
      .select({ userId: davomatFingerprintsTable.userId })
      .from(davomatFingerprintsTable)
      .where(eq(davomatFingerprintsTable.deviceKeyHash, sha256(key)))
      .limit(1);
    if (taken && taken.userId !== userId) return fail(409, "finger_device_taken", DEVICE_TAKEN);
  }

  // Boshqa xodimlarning barmoq izlari — shu qurilmada bo‘lsa, autentifikator o‘zi rad etadi.
  const all = await db
    .select({ credentialId: davomatFingerprintsTable.credentialId, transports: davomatFingerprintsTable.transports })
    .from(davomatFingerprintsTable);

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: `${user.login}·davomat`,
    userDisplayName: `${user.fullName} — davomat`,
    userID: userIdBytes(user.id),
    attestationType: "none",
    timeout: 120_000,
    excludeCredentials: all.map((c) => ({ id: c.credentialId, transports: parseTransports(c.transports) })),
    preferredAuthenticatorType: "localDevice",
    authenticatorSelection: {
      residentKey: "discouraged",
      requireResidentKey: false,
      userVerification: "required",
    },
  });
  await saveChallenge("fp_register", options.challenge, userId, REGISTER_TTL_MS);
  return { ok: true as const, options };
}

export async function fingerprintRegisterVerify(req: Request, res: Response, userId: number) {
  const body = req.body?.credential as RegistrationResponseJSON | undefined;
  if (!body?.id || !body?.response?.clientDataJSON) {
    return fail(400, "finger_bad_response", "Barmoq izi javobi noto‘g‘ri — qayta urinib ko‘ring");
  }
  const rp = rpOrFail(req);
  if ("ok" in rp) return rp;
  const challenge = await takeChallenge(body.response.clientDataJSON, "fp_register", userId);
  if (!challenge) return fail(400, "finger_expired", "Vaqt tugadi — «Ro‘yxatdan o‘tkazish»ni qayta bosing");
  if (await getFingerprintEnrollment(userId)) return fail(409, "finger_already_enrolled", ALREADY_ENROLLED);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("fingerprint register verify:", err);
    return fail(400, "finger_not_verified", "Barmoq izi tasdiqlanmadi — qayta urinib ko‘ring");
  }
  if (!verification.verified || !verification.registrationInfo) {
    return fail(400, "finger_not_verified", "Barmoq izi tasdiqlanmadi — qayta urinib ko‘ring");
  }
  const info = verification.registrationInfo;
  if (!info.userVerified) {
    return fail(400, "finger_no_uv", "Barmoq izi skaneri orqali tasdiqlang");
  }

  const credentialId = info.credential.id;
  const [dupCred] = await db
    .select({ userId: davomatFingerprintsTable.userId })
    .from(davomatFingerprintsTable)
    .where(eq(davomatFingerprintsTable.credentialId, credentialId))
    .limit(1);
  if (dupCred) return fail(409, "finger_device_taken", DEVICE_TAKEN);

  let key = readDeviceKey(req);
  if (key) {
    const [taken] = await db
      .select({ userId: davomatFingerprintsTable.userId })
      .from(davomatFingerprintsTable)
      .where(eq(davomatFingerprintsTable.deviceKeyHash, sha256(key)))
      .limit(1);
    if (taken) {
      if (taken.userId !== userId) return fail(409, "finger_device_taken", DEVICE_TAKEN);
    }
  } else {
    key = randomToken(32);
  }

  const ua = String(req.headers["user-agent"] || "").slice(0, 500);
  try {
    await db.insert(davomatFingerprintsTable).values({
      userId,
      credentialId,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter ?? 0,
      deviceKeyHash: sha256(key),
      deviceType: info.credentialDeviceType ?? null,
      backedUp: Boolean(info.credentialBackedUp),
      transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
      aaguid: info.aaguid ?? null,
      deviceLabel: deviceLabelFromUa(ua),
      userAgent: ua,
      ipAddress: clientIp(req),
    });
  } catch (err) {
    // Unikal indeks: bir vaqtda ikki so‘rov yoki qurilma/credential band
    console.error("fingerprint enroll insert:", err);
    if (await getFingerprintEnrollment(userId)) return fail(409, "finger_already_enrolled", ALREADY_ENROLLED);
    return fail(409, "finger_device_taken", DEVICE_TAKEN);
  }
  setDeviceKey(res, key);
  return { ok: true as const, deviceLabel: deviceLabelFromUa(ua) };
}

async function assertPunchDevice(req: Request, userId: number) {
  const row = await getFingerprintEnrollment(userId);
  if (!row) {
    return fail(404, "finger_not_enrolled", "Barmoq izingiz hali ro‘yxatdan o‘tmagan — avval ro‘yxatdan o‘tkazing");
  }
  const key = readDeviceKey(req);
  if (!key || sha256(key) !== row.deviceKeyHash) {
    return fail(
      403,
      "finger_wrong_device",
      `Barmoq izi faqat ro‘yxatdan o‘tgan qurilmada ishlaydi${row.deviceLabel ? ` (${row.deviceLabel})` : ""}. Telefon almashgan bo‘lsa — admin bilan bog‘laning.`,
    );
  }
  return { ok: true as const, row };
}

export async function fingerprintPunchOptions(req: Request, userId: number) {
  const rp = rpOrFail(req);
  if ("ok" in rp) return rp;
  const dev = await assertPunchDevice(req, userId);
  if (!dev.ok) return dev;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
    timeout: 90_000,
    allowCredentials: [{ id: dev.row.credentialId, transports: parseTransports(dev.row.transports) }],
  });
  await saveChallenge("fp_punch", options.challenge, userId, PUNCH_TTL_MS);
  return { ok: true as const, options };
}

/** Davomat oldidan: barmoq izi aynan shu akkauntniki va aynan shu qurilmadami. */
export async function fingerprintPunchVerify(req: Request, userId: number) {
  const body = req.body?.assertion as AuthenticationResponseJSON | undefined;
  if (!body?.id || !body?.response?.clientDataJSON) {
    return fail(400, "finger_bad_response", "Barmoq izi javobi noto‘g‘ri — qayta urinib ko‘ring");
  }
  const rp = rpOrFail(req);
  if ("ok" in rp) return rp;
  const dev = await assertPunchDevice(req, userId);
  if (!dev.ok) return dev;
  const row = dev.row;
  if (body.id !== row.credentialId) {
    return fail(403, "finger_not_owner", "Bu barmoq izi sizning akkauntingizga tegishli emas");
  }
  const challenge = await takeChallenge(body.response.clientDataJSON, "fp_punch", userId);
  if (!challenge) return fail(400, "finger_expired", "Vaqt tugadi — barmoq izini qayta qo‘ying");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: row.credentialId,
        publicKey: Uint8Array.from(Buffer.from(row.publicKey, "base64url")),
        counter: row.counter ?? 0,
        transports: parseTransports(row.transports),
      },
      requireUserVerification: true,
    });
  } catch (err) {
    console.error("fingerprint punch verify:", err);
    return fail(401, "finger_mismatch", "Barmoq izi mos kelmadi — qayta urinib ko‘ring");
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    return fail(401, "finger_mismatch", "Barmoq izi mos kelmadi — qayta urinib ko‘ring");
  }
  if (body.response.userHandle) {
    const handle = Buffer.from(body.response.userHandle, "base64url");
    const expected = Buffer.from(userIdBytes(userId));
    if (!handle.equals(expected)) {
      return fail(403, "finger_not_owner", "Bu barmoq izi sizning akkauntingizga tegishli emas");
    }
  }
  await db
    .update(davomatFingerprintsTable)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
      useCount: (row.useCount ?? 0) + 1,
    })
    .where(eq(davomatFingerprintsTable.id, row.id));
  return { ok: true as const };
}

export async function resetFingerprint(userId: number) {
  const removed = await db
    .delete(davomatFingerprintsTable)
    .where(eq(davomatFingerprintsTable.userId, userId))
    .returning({ id: davomatFingerprintsTable.id, deviceLabel: davomatFingerprintsTable.deviceLabel });
  await db
    .delete(webauthnChallengesTable)
    .where(
      and(
        eq(webauthnChallengesTable.userId, userId),
        inArray(webauthnChallengesTable.kind, ["fp_register", "fp_punch"]),
      ),
    );
  return removed[0] ?? null;
}
