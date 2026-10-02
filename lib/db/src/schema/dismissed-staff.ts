import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Bo‘shatilganlar arxivi — Foydalanuvchilardan o‘chirilgan odamning surati.
 * users/employees yozuvi o‘chiriladi (login/parol, davomat, ro‘yxatlar — hech qayerda yo‘q),
 * faqat shu jadvalda qoladi.
 */
export const dismissedStaffTable = pgTable(
  "dismissed_staff",
  {
    id: serial("id").primaryKey(),
    formerUserId: integer("former_user_id"),
    formerEmployeeId: integer("former_employee_id"),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    role: text("role"),
    login: text("login"),
    departmentId: integer("department_id"),
    departmentName: text("department_name"),
    position: text("position"),
    location: text("location"),
    hiredAt: text("hired_at"),
    reportsToId: integer("reports_to_id"),
    orgRole: text("org_role"),
    shiftType: text("shift_type"),
    shiftLabel: text("shift_label"),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedById: integer("dismissed_by_id"),
    dismissedByName: text("dismissed_by_name"),
    reason: text("reason"),
  },
  (t) => [index("dismissed_staff_dismissed_at_idx").on(t.dismissedAt)],
);
