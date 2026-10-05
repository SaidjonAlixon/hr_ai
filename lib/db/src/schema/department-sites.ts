import { doublePrecision, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Bo‘limning nomlangan davomat joyi (masalan Tamojni sklad). */
export const departmentSitesTable = pgTable(
  "department_sites",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id").notNull(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    radiusM: integer("radius_m").notNull().default(100),
    updatedById: integer("updated_by_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("department_sites_dept_uidx").on(t.departmentId)],
);
