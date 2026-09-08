import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable, pushVapidKeysTable } from "@workspace/db";
import { logger } from "./logger";

type VapidPair = { publicKey: string; privateKey: string; subject: string };

let cached: VapidPair | null = null;
let configured = false;

async function loadOrCreateVapid(): Promise<VapidPair> {
  if (cached) return cached;

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = (process.env.VAPID_SUBJECT || "mailto:admin@vaksina.local").trim();

  if (envPub && envPriv) {
    cached = { publicKey: envPub, privateKey: envPriv, subject };
    return cached;
  }

  const [row] = await db.select().from(pushVapidKeysTable).where(eq(pushVapidKeysTable.id, 1)).limit(1);
  if (row?.publicKey && row?.privateKey) {
    cached = { publicKey: row.publicKey, privateKey: row.privateKey, subject: row.subject || subject };
    return cached;
  }

  const generated = webpush.generateVAPIDKeys();
  cached = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
  try {
    if (row) {
      await db
        .update(pushVapidKeysTable)
        .set({
          publicKey: cached.publicKey,
          privateKey: cached.privateKey,
          subject: cached.subject,
          updatedAt: new Date(),
        })
        .where(eq(pushVapidKeysTable.id, 1));
    } else {
      await db.insert(pushVapidKeysTable).values({
        id: 1,
        publicKey: cached.publicKey,
        privateKey: cached.privateKey,
        subject: cached.subject,
        updatedAt: new Date(),
      });
    }
  } catch (err) {
    logger.warn({ err }, "VAPID DB save failed — using in-memory keys");
  }
  logger.info("VAPID keys generated and stored");
  return cached;
}

async function ensureWebPushConfigured(): Promise<VapidPair> {
  const keys = await loadOrCreateVapid();
  if (!configured) {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    configured = true;
  }
  return keys;
}

export async function getVapidPublicKey(): Promise<string> {
  const keys = await ensureWebPushConfigured();
  return keys.publicKey;
}

export async function savePushSubscription(opts: {
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await ensureWebPushConfigured();
  const now = new Date();
  const existing = await db
    .select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, opts.endpoint))
    .limit(1);

  if (existing[0]) {
    await db
      .update(pushSubscriptionsTable)
      .set({
        userId: opts.userId,
        p256dh: opts.p256dh,
        auth: opts.auth,
        userAgent: opts.userAgent || null,
        updatedAt: now,
      })
      .where(eq(pushSubscriptionsTable.id, existing[0].id));
    return;
  }

  await db.insert(pushSubscriptionsTable).values({
    userId: opts.userId,
    endpoint: opts.endpoint,
    p256dh: opts.p256dh,
    auth: opts.auth,
    userAgent: opts.userAgent || null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removePushSubscription(endpoint: string, userId?: number): Promise<boolean> {
  const rows = await db
    .select({ id: pushSubscriptionsTable.id, userId: pushSubscriptionsTable.userId })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  if (userId != null && row.userId !== userId) return false;
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, row.id));
  return true;
}

export async function countUserPushSubscriptions(userId: number): Promise<number> {
  const rows = await db
    .select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  return rows.length;
}

/** Telefonga tizim push (Chrome / Safari PWA) — Telegramdan mustaqil */
export async function sendWebPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; failed: number }> {
  await ensureWebPushConfigured();
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  if (!subs.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    tag: payload.tag || "vaksina-hr",
  });

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        body,
        { urgency: "high", TTL: 60 * 60 },
      );
      sent += 1;
    } catch (err: unknown) {
      failed += 1;
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      logger.warn({ err, userId, endpoint: s.endpoint.slice(0, 48) }, "Web push failed");
      if (statusCode === 404 || statusCode === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id));
      }
    }
  }
  return { sent, failed };
}
