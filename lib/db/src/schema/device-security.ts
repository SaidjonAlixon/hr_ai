import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Global + ofis/dorixona siyosatlari (bitta qator id=1) */
export const deviceSecuritySettingsTable = pgTable("device_security_settings", {
  id: serial("id").primaryKey(),
  /** off | selected | office | pharmacy | all */
  enforcementMode: text("enforcement_mode").notNull().default("selected"),
  officeMaxDevices: integer("office_max_devices").notNull().default(2),
  pharmacyMaxDevices: integer("pharmacy_max_devices").notNull().default(1),
  officeRequireApprove: boolean("office_require_approve").notNull().default(true),
  pharmacyRequireApprove: boolean("pharmacy_require_approve").notNull().default(true),
  officeBlockForeign: boolean("office_block_foreign").notNull().default(true),
  pharmacyBlockForeign: boolean("pharmacy_block_foreign").notNull().default(true),
  officeVerifyQr: boolean("office_verify_qr").notNull().default(true),
  pharmacyVerifyQr: boolean("pharmacy_verify_qr").notNull().default(true),
  officeVerifyFace: boolean("office_verify_face").notNull().default(true),
  pharmacyVerifyFace: boolean("pharmacy_verify_face").notNull().default(true),
  logIpChanges: boolean("log_ip_changes").notNull().default(true),
  suspiciousNotify: boolean("suspicious_notify").notNull().default(true),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userDevicesTable = pgTable(
  "user_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    /** Public device id (cookie/client) */
    deviceId: text("device_id").notNull(),
    /** sha256(device_token) */
    deviceTokenHash: text("device_token_hash").notNull(),
    deviceName: text("device_name"),
    /** mobile | desktop | tablet | unknown */
    deviceType: text("device_type").notNull().default("unknown"),
    /** office | pharmacy | general */
    slot: text("slot").notNull().default("general"),
    os: text("os"),
    osVersion: text("os_version"),
    browser: text("browser"),
    browserVersion: text("browser_version"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    lastIp: text("last_ip"),
    approxLocation: text("approx_location"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedBy: integer("blocked_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_devices_device_id_uidx").on(t.deviceId),
    index("user_devices_user_idx").on(t.userId),
    index("user_devices_user_verified_idx").on(t.userId, t.isVerified),
  ],
);

export const userSessionsTable = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    deviceRowId: integer("device_row_id"),
    /** sha256(session_token) */
    sessionTokenHash: text("session_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("user_sessions_token_uidx").on(t.sessionTokenHash),
    index("user_sessions_user_idx").on(t.userId),
  ],
);

export const loginAuditLogsTable = pgTable(
  "login_audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    deviceRowId: integer("device_row_id"),
    deviceId: text("device_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    action: text("action").notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_audit_user_idx").on(t.userId),
    index("login_audit_created_idx").on(t.createdAt),
  ],
);

export const deviceChangeRequestsTable = pgTable(
  "device_change_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    oldDeviceRowId: integer("old_device_row_id"),
    newDeviceRowId: integer("new_device_row_id"),
    /** pending | approved | rejected */
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by"),
  },
  (t) => [index("device_change_req_user_idx").on(t.userId), index("device_change_req_status_idx").on(t.status)],
);

export const securityEventsTable = pgTable(
  "security_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    deviceRowId: integer("device_row_id"),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().default("medium"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: integer("resolved_by"),
  },
  (t) => [
    index("security_events_user_idx").on(t.userId),
    index("security_events_created_idx").on(t.createdAt),
  ],
);
