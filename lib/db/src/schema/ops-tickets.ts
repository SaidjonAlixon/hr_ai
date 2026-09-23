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
  /** new | accepted | in_progress | waiting_parts | done | verified | closed */
  status: text("status").notNull().default("new"),
  createdById: integer("created_by_id"),
  assigneeId: integer("assignee_id"),
  /** Bo‘lim boshlig‘i kimga yo‘naltirdi */
  assignedById: integer("assigned_by_id"),
  /** AyTi qabul qilgan vaqt */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedById: integer("accepted_by_id"),
  /** AyTi bajargan vaqt */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedById: integer("completed_by_id"),
  /** Ariza egasi tasdiqlagan vaqt */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedById: integer("verified_by_id"),
  /** done | partial | not_done — ariza egasi bahosi */
  verifyResult: text("verify_result"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /** Qabuldan keyin yaratilgan topshiriq */
  taskId: integer("task_id"),
  /** 24 soat qabul qilinmasa HR/admin ga eskalatsiya */
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
