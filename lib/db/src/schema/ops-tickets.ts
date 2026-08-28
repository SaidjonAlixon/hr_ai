import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/** IT va Texnik bo‘limlari — ariza / ish varaqasi */
export const opsTicketsTable = pgTable("ops_tickets", {
  id: serial("id").primaryKey(),
  ticketNo: text("ticket_no").notNull(),
  /** it | texnik */
  dept: text("dept").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  branchName: text("branch_name"),
  /** low | normal | high | urgent */
  priority: text("priority").notNull().default("normal"),
  /** new | assigned | in_progress | waiting_parts | done | closed */
  status: text("status").notNull().default("new"),
  createdById: integer("created_by_id"),
  assigneeId: integer("assignee_id"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
