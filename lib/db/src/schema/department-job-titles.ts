import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

/** Bo‘lim lavozimlari (Distribyutsiya va boshqalar) — tahrirlanadigan katalog */
export const departmentJobTitlesTable = pgTable("department_job_titles", {
  id: serial("id").primaryKey(),
  departmentId: integer("department_id").notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
