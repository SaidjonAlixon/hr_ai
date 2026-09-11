import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

export type ReminderAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  url: string;
  size?: number;
};

export type ReminderCategory =
  | "work"
  | "personal"
  | "meeting"
  | "check"
  | "finance"
  | "other";

export type ReminderPriority = "low" | "medium" | "high" | "critical";

/**
 * Shaxsiy eslatmalar (Eslatmalarim).
 * status: active | completed | missed
 * remindIntervalMinutes: null = faqat bir marta (notifyAt), aks holda davriy
 */
export const remindersTable = pgTable("reminders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  /** Kim yaratgan (boshqaga biriktirilganda yaratuvchi) */
  createdById: integer("created_by_id"),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  /** Birinchi ogohlantirish vaqti */
  notifyAt: timestamp("notify_at", { withTimezone: true }),
  /** Qayta eslatish oralig‘i (daqiqa). null = faqat notifyAt */
  remindIntervalMinutes: integer("remind_interval_minutes"),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  attachments: jsonb("attachments").notNull().default([]),
  /** work | personal | meeting | check | finance | other */
  category: text("category").notNull().default("work"),
  /** low | medium | high | critical */
  priority: text("priority").notNull().default("medium"),
  /** Tizim ichida bildirishnoma */
  notifySystem: boolean("notify_system").notNull().default(true),
  /** Telegram orqali yuborish */
  notifyTelegram: boolean("notify_telegram").notNull().default(false),
  status: text("status").notNull().default("active"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Eslatma tarixi: yaratish, muddat ko‘chirish, bajarish, kechikish, ogohlantirish.
 */
export const reminderEventsTable = pgTable("reminder_events", {
  id: serial("id").primaryKey(),
  reminderId: integer("reminder_id").notNull(),
  eventType: text("event_type").notNull(),
  // created | due_changed | completed | reopened | missed | notified | note
  note: text("note"),
  fromDueAt: timestamp("from_due_at", { withTimezone: true }),
  toDueAt: timestamp("to_due_at", { withTimezone: true }),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
