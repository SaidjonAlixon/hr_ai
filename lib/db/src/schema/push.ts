import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Brauzer Web Push (Chrome / Safari PWA) obunalari */
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uidx").on(t.endpoint)],
);

/** VAPID kalitlari (env bo‘lmasa DB’da saqlanadi) */
export const pushVapidKeysTable = pgTable("push_vapid_keys", {
  id: integer("id").primaryKey().default(1),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject").notNull().default("mailto:admin@vaksina.local"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
