import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

/**
 * Xodim unvoni (galochka) — faqat admin beradi.
 * title: faol | ishonchli | professional | premium | rivojlanish | null.
 * pro_hidden — rahbarlarning avtomatik PRO belgisi admin tomonidan o‘chirilgan.
 * pro_tier — admin bergan PRO turi (founder | director | hr | lead | master); rol bo‘yicha turdan ustun turadi.
 */
export const userTitlesTable = pgTable("user_titles", {
  userId: integer("user_id").primaryKey(),
  title: text("title"),
  note: text("note"),
  proHidden: boolean("pro_hidden").notNull().default(false),
  proTier: text("pro_tier"),
  proNote: text("pro_note"),
  assignedById: integer("assigned_by_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** action: assign | remove | pro_hide | pro_show | pro_grant | pro_revoke */
export const userTitleHistoryTable = pgTable("user_title_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  title: text("title"),
  prevTitle: text("prev_title"),
  note: text("note"),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
