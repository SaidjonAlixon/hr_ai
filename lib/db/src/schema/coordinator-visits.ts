import { pgTable, text, serial, timestamp, integer, doublePrecision, index } from "drizzle-orm/pg-core";

/**
 * Koordinator filial tashrifi — Keldim → Cheklist → Ketdim.
 * Ochiq tashrif (Ketdim yo‘q) bo‘lsa boshqa filialga o‘tib bo‘lmaydi.
 */
export const coordinatorBranchVisitsTable = pgTable(
  "coordinator_branch_visits",
  {
    id: serial("id").primaryKey(),
    coordinatorUserId: integer("coordinator_user_id").notNull(),
    coordinatorEmployeeId: integer("coordinator_employee_id"),
    coordinatorName: text("coordinator_name"),
    /** Filial = mudir employee id */
    branchId: integer("branch_id").notNull(),
    branchLabel: text("branch_label"),
    /** YYYY-MM-DD (Toshkent) */
    workDate: text("work_date").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkInLatitude: doublePrecision("check_in_latitude"),
    checkInLongitude: doublePrecision("check_in_longitude"),
    checkOutLatitude: doublePrecision("check_out_latitude"),
    checkOutLongitude: doublePrecision("check_out_longitude"),
    /** branch_audits.id — shu tashrifda saqlangan cheklist */
    checklistAuditId: integer("checklist_audit_id"),
    checklistAt: timestamp("checklist_at", { withTimezone: true }),
    /** Ketdim — «bugun bu yerda nima qildingiz?» */
    checkoutNote: text("checkout_note"),
    /** open | closed */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("coord_visits_user_status_idx").on(t.coordinatorUserId, t.status),
    index("coord_visits_branch_idx").on(t.branchId),
    index("coord_visits_work_date_idx").on(t.workDate),
    index("coord_visits_checklist_idx").on(t.checklistAuditId),
  ],
);
