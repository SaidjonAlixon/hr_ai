import { pgTable, integer, boolean, text, timestamp, index } from "drizzle-orm/pg-core";

/** Admin belgilagan yashil hudud tasdiqi. Standart: o‘chiq. */
export const zonePresenceRulesTable = pgTable(
  "zone_presence_rules",
  {
    userId: integer("user_id").primaryKey(),
    employeeId: integer("employee_id"),
    enabled: boolean("enabled").notNull().default(false),
    /** Har necha soatda tasdiq */
    intervalHours: integer("interval_hours").notNull().default(2),
    /** Tasdiqlash oynasi, daqiqa */
    windowMinutes: integer("window_minutes").notNull().default(15),
    /** FACE_ID | QR */
    method: text("method").notNull().default("FACE_ID"),
    cycleStartedAt: timestamp("cycle_started_at", { withTimezone: true }),
    promptAt: timestamp("prompt_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    promptNotifiedAt: timestamp("prompt_notified_at", { withTimezone: true }),
    /** YYYY-MM-DD — shu kun blok */
    blockedOn: text("blocked_on"),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockNotifiedOn: text("block_notified_on"),
    unlockedOn: text("unlocked_on"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    unlockedBy: integer("unlocked_by"),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("zone_presence_enabled_idx").on(t.enabled)],
);
