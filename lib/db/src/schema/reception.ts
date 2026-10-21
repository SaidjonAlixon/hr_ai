import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Resepshin qaydlari — suhbat, ofis tashrifi, boshqa murojaatlar.
 * visitType: interview | office_visit | other
 * status: waiting | in_progress | done | cancelled | no_show
 */
export const receptionLogsTable = pgTable(
  "reception_logs",
  {
    id: serial("id").primaryKey(),
    /** interview | office_visit | other */
    visitType: text("visit_type").notNull(),
    /** other uchun: delivery | complaint | call | document | package | other */
    topic: text("topic"),
    visitorFullName: text("visitor_full_name").notNull(),
    visitorPhone: text("visitor_phone"),
    /** Nomzod lavozimi / kelgan odam roli: stajyor, farmasevt, mehmon, ... */
    visitorRoleHint: text("visitor_role_hint"),
    /** Kimning oldiga / kim bilan */
    hostName: text("host_name"),
    hostUserId: integer("host_user_id"),
    /** Suhbatni kim olib turgani (faqat interview) */
    interviewerName: text("interviewer_name"),
    interviewerUserId: integer("interviewer_user_id"),
    /** Nima uchun kelgan */
    purpose: text("purpose"),
    notes: text("notes"),
    /** waiting | in_progress | done | cancelled | no_show */
    status: text("status").notNull().default("waiting"),
    /** Kelish (rejalashtirilgan yoki haqiqiy) */
    visitAt: timestamp("visit_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    loggedByUserId: integer("logged_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("reception_logs_visit_at_idx").on(t.visitAt),
    index("reception_logs_type_idx").on(t.visitType),
    index("reception_logs_status_idx").on(t.status),
    index("reception_logs_logged_by_idx").on(t.loggedByUserId),
  ],
);
