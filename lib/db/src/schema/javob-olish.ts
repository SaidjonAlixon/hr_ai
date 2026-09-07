import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Javob olish so‘rovlari — HAR BIR SANA alohida yozuv.
 * status: pending | approved | rejected | cancelled
 */
export const javobOlishRequestsTable = pgTable(
  "javob_olish_requests",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    userId: integer("user_id"),
    workDate: text("work_date").notNull(), // YYYY-MM-DD
    /** Snapshot: smena oynasi */
    shiftType: text("shift_type"),
    shiftLabel: text("shift_label"),
    shiftStartHm: text("shift_start_hm").notNull(),
    shiftEndHm: text("shift_end_hm").notNull(),
    shiftOvernight: integer("shift_overnight").notNull().default(0),
    /** Javob olish oralig‘i */
    fromHm: text("from_hm").notNull(),
    toHm: text("to_hm").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    /** Majburiy izoh — kun uchun alohida */
    note: text("note").notNull(),
    status: text("status").notNull().default("pending"),
    coordinatorUserId: integer("coordinator_user_id"),
    decidedById: integer("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("javob_olish_emp_idx").on(t.employeeId),
    index("javob_olish_date_idx").on(t.workDate),
    index("javob_olish_status_idx").on(t.status),
    index("javob_olish_coord_idx").on(t.coordinatorUserId),
  ],
);
