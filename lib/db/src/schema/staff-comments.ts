import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Bo‘lim HR izohlari xodim haqida (Distribyutsiya HR va boshqalar).
 * Kech kelish / erta ketish bo‘yicha izohda relatedDate — o‘sha ish kuni.
 */
export const staffCommentsTable = pgTable("staff_comments", {
  id: serial("id").primaryKey(),
  /** users.id — izoh kim haqida */
  userId: integer("user_id").notNull(),
  employeeId: integer("employee_id"),
  departmentId: integer("department_id"),
  /** note | late | early | warning | praise */
  kind: text("kind").notNull().default("note"),
  /** YYYY-MM-DD */
  relatedDate: text("related_date"),
  text: text("text").notNull(),
  authorId: integer("author_id"),
  authorName: text("author_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
