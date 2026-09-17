import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull(), // admin|recruiter|hr|trainer|mentor|director|department_head|mudir|koordinator|sb|sb_boshliq
  departmentId: integer("department_id"),
  login: text("login").notNull().unique(),
  password: text("password").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("active"), // active|vacant|terminated|on_leave
  /** Telegram user id (string) — bot orqali bog‘langan akkaunt */
  telegramId: text("telegram_id"),
  /** Device security majburiy (enforcementMode=selected) */
  deviceSecurityEnforced: boolean("device_security_enforced").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
