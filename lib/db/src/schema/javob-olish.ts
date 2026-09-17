import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Javob olish so‘rovlari — HAR BIR SANA alohida yozuv.
 * status:
 *   pending_coord — 1-koordinator kutmoqda
 *   pending_hr — HR kutmoqda (koordinator tasdiqlagan yoki 8 soat escalate)
 *   approved — yakuniy (HR)
 *   rejected | cancelled
 */
export const javobOlishRequestsTable = pgTable(
  "javob_olish_requests",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    userId: integer("user_id"),
    workDate: text("work_date").notNull(), // YYYY-MM-DD
    shiftType: text("shift_type"),
    shiftLabel: text("shift_label"),
    shiftStartHm: text("shift_start_hm").notNull(),
    shiftEndHm: text("shift_end_hm").notNull(),
    shiftOvernight: integer("shift_overnight").notNull().default(0),
    fromHm: text("from_hm").notNull(),
    toHm: text("to_hm").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    note: text("note").notNull(),
    status: text("status").notNull().default("pending_coord"),
    coordinatorUserId: integer("coordinator_user_id"),
    /** Koordinator qarori */
    coordDecidedById: integer("coord_decided_by_id"),
    coordDecidedAt: timestamp("coord_decided_at", { withTimezone: true }),
    coordDecisionNote: text("coord_decision_note"),
    /** 8 soat ichida javob yo‘q → escalate */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalatedNote: text("escalated_note"),
    /** Yakuniy qaror (HR) */
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
