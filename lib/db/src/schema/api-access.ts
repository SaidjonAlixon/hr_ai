import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** Bosh admin beradigan tashqi read-only API tokenlari */
export const apiAccessTokensTable = pgTable(
  "api_access_tokens",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull(),
    note: text("note"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_access_tokens_hash_idx").on(t.tokenHash),
    index("api_access_tokens_prefix_idx").on(t.tokenPrefix),
  ],
);

/** Token orqali kelgan so‘rovlar jurnali (API Devor) */
export const apiAccessLogsTable = pgTable(
  "api_access_logs",
  {
    id: serial("id").primaryKey(),
    tokenId: integer("token_id").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),
    querySummary: text("query_summary"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_access_logs_token_idx").on(t.tokenId),
    index("api_access_logs_created_idx").on(t.createdAt),
    index("api_access_logs_path_idx").on(t.path),
  ],
);
