import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/** Hikvision terminal employeeNo → HR Pro user */
export const hikvisionPersonMapTable = pgTable(
  "hikvision_person_map",
  {
    id: serial("id").primaryKey(),
    employeeNo: text("employee_no").notNull(),
    userId: integer("user_id").notNull(),
    employeeId: integer("employee_id"),
    deviceName: text("device_name"),
    /** manual | auto_name */
    matchedBy: text("matched_by").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("hikvision_person_map_emp_no_uidx").on(t.employeeNo),
    index("hikvision_person_map_user_idx").on(t.userId),
  ],
);

/** Ishlangan terminal eventlari (takroriy yozuvni oldini olish) */
export const hikvisionEventLogTable = pgTable(
  "hikvision_event_log",
  {
    id: serial("id").primaryKey(),
    deviceSerial: text("device_serial").notNull().default("default"),
    eventSerial: integer("event_serial"),
    eventKey: text("event_key").notNull(),
    employeeNo: text("employee_no"),
    action: text("action"),
    attendanceStatus: text("attendance_status"),
    result: text("result").notNull(),
    error: text("error"),
    userId: integer("user_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hikvision_event_log_key_uidx").on(t.eventKey),
    index("hikvision_event_log_created_idx").on(t.createdAt),
  ],
);
