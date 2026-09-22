import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * «Xodim kerak» so‘rovi — koordinator (filial) yoki bo‘lim boshlig‘i (ofis).
 * status:
 *   pending_hr — HR menejer tasdiǧi kutilmoqda
 *   approved   — HR tasdiqlagan
 *   searching  — qidiruvda (bot ko‘radi)
 *   found      — topildi / yopiq (botdan yo‘qoladi)
 *   rejected   — HR rad etgan
 *   cancelled  — yuboruvchi bekor qilgan
 */
export const staffNeedRequestsTable = pgTable("staff_need_requests", {
  id: serial("id").primaryKey(),
  /** Yuboruvchi (koordinator yoki bo‘lim boshlig‘i) */
  coordinatorUserId: integer("coordinator_user_id").notNull(),
  /** Filial mudir employee id — ofis so‘rovda NULL */
  managerEmployeeId: integer("manager_employee_id"),
  branchLocation: text("branch_location"),
  shiftType: text("shift_type").notNull().default("one"),
  shiftLabel: text("shift_label"),
  /** farmasevt | mudir | stajyor | custom */
  roleNeeded: text("role_needed").notNull().default("farmasevt"),
  /** Bo‘lim boshlig‘i erkin matn (qanday xodim) */
  positionText: text("position_text"),
  /** pharmacy | office */
  sourceType: text("source_type").notNull().default("pharmacy"),
  /** Qachon kerak — YYYY-MM-DD yoki matn */
  neededBy: text("needed_by"),
  count: integer("count").notNull().default(1),
  note: text("note"),
  status: text("status").notNull().default("pending_hr"),
  hrApprovedById: integer("hr_approved_by_id"),
  hrApprovedAt: timestamp("hr_approved_at", { withTimezone: true }),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  foundById: integer("found_by_id"),
  foundAt: timestamp("found_at", { withTimezone: true }),
  rejectedById: integer("rejected_by_id"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  requestId: integer("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
