import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Omborxona smenalari — boshliq yaratadi (nom + boshlanish/tugash soati).
 */
export const warehouseShiftsTable = pgTable(
  "warehouse_shifts",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id").notNull(),
    name: text("name").notNull(),
    startHm: text("start_hm").notNull(),
    endHm: text("end_hm").notNull(),
    overnight: boolean("overnight").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("wh_shifts_dept_idx").on(t.departmentId),
    index("wh_shifts_active_idx").on(t.active),
  ],
);

/**
 * Omborxona xodimi → smena biriktirish (qo‘l ostidagi xodimlar).
 * Bir xodimda faqat bitta faol smena.
 */
export const warehouseShiftMembersTable = pgTable(
  "warehouse_shift_members",
  {
    id: serial("id").primaryKey(),
    shiftId: integer("shift_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    departmentId: integer("department_id").notNull(),
    active: boolean("active").notNull().default(true),
    assignedById: integer("assigned_by_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("wh_shift_members_shift_idx").on(t.shiftId),
    index("wh_shift_members_emp_idx").on(t.employeeId),
  ],
);
