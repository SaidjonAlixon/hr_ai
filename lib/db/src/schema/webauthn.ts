import { pgTable, text, serial, timestamp, integer, bigint, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

/** Face ID / Windows Hello / Touch ID (WebAuthn passkey) */
export const webauthnCredentialsTable = pgTable(
  "webauthn_credentials",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** base64url credential id */
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webauthn_credentials_cred_uidx").on(t.credentialId),
    index("webauthn_credentials_user_idx").on(t.userId),
  ],
);

/**
 * Davomat barmoq izi: 1 akkaunt = 1 barmoq izi = 1 qurilma.
 * device_key_hash — shu qurilmaga yozilgan maxfiy cookie (fp_bind) hash'i; boshqa qurilmada ishlamaydi.
 */
export const davomatFingerprintsTable = pgTable(
  "davomat_fingerprints",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    deviceKeyHash: text("device_key_hash").notNull(),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    deviceLabel: text("device_label"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    useCount: integer("use_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("davomat_fingerprints_user_uidx").on(t.userId),
    uniqueIndex("davomat_fingerprints_cred_uidx").on(t.credentialId),
    uniqueIndex("davomat_fingerprints_device_uidx").on(t.deviceKeyHash),
  ],
);

export const webauthnChallengesTable = pgTable(
  "webauthn_challenges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    challenge: text("challenge").notNull(),
    kind: text("kind").notNull(), // register | login
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webauthn_challenges_challenge_idx").on(t.challenge)],
);
