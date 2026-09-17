import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Global sozlamalar (id=1) */
export const mobileAttendanceSettingsTable = pgTable("mobile_attendance_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  requireGps: boolean("require_gps").notNull().default(true),
  requireActiveShift: boolean("require_active_shift").notNull().default(false),
  routeTrackingDefault: boolean("route_tracking_default").notNull().default(false),
  gpsIntervalMin: integer("gps_interval_min").notNull().default(10),
  maxAccuracyMeters: integer("max_accuracy_meters").notNull().default(50),
  allowStartAnywhere: boolean("allow_start_anywhere").notNull().default(true),
  allowEndAnywhere: boolean("allow_end_anywhere").notNull().default(true),
  detectSuspicious: boolean("detect_suspicious").notNull().default(true),
  createSecurityEvents: boolean("create_security_events").notNull().default(true),
  retentionDays: integer("retention_days").notNull().default(90),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin bergan ruxsat.
 * permissionType: permanent | temporary | weekdays | shift
 */
export const mobileAttendancePermissionsTable = pgTable(
  "mobile_attendance_permissions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    userId: integer("user_id"),
    grantedById: integer("granted_by_id").notNull(),
    /** active | revoked */
    status: text("status").notNull().default("active"),
    permissionType: text("permission_type").notNull().default("permanent"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    /** 1=Du … 7=Ya */
    weekdays: jsonb("weekdays").$type<number[] | null>(),
    /** one | two | three | office | null */
    shiftKey: text("shift_key"),
    note: text("note"),
    allowAnywhere: boolean("allow_anywhere").notNull().default(true),
    allowStartAnywhere: boolean("allow_start_anywhere").notNull().default(true),
    allowEndAnywhere: boolean("allow_end_anywhere").notNull().default(true),
    routeTrackingEnabled: boolean("route_tracking_enabled").notNull().default(false),
    gpsIntervalMin: integer("gps_interval_min"),
    maxAccuracyMeters: integer("max_accuracy_meters"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: integer("revoked_by_id"),
  },
  (t) => [
    index("mobile_att_perm_emp_idx").on(t.employeeId),
    index("mobile_att_perm_status_idx").on(t.status),
    index("mobile_att_perm_user_idx").on(t.userId),
  ],
);

/** Kunlik ko‘chma davomat sessiyasi (MOBILE_GPS) */
export const mobileAttendanceSessionsTable = pgTable(
  "mobile_attendance_sessions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    userId: integer("user_id"),
    permissionId: integer("permission_id"),
    workDate: text("work_date").notNull(),
    shiftKey: text("shift_key"),
    branchId: integer("branch_id"),
    branchLabel: text("branch_label"),
    /** open | closed | cancelled */
    status: text("status").notNull().default("open"),
    /** ok | suspicious | blocked */
    securityStatus: text("security_status").notNull().default("ok"),
    deviceRowId: integer("device_row_id"),
    deviceId: text("device_id"),
    sessionTokenHash: text("session_token_hash"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    startLatitude: doublePrecision("start_latitude").notNull(),
    startLongitude: doublePrecision("start_longitude").notNull(),
    startAccuracy: doublePrecision("start_accuracy"),
    startLocationTs: timestamp("start_location_ts", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    endLatitude: doublePrecision("end_latitude"),
    endLongitude: doublePrecision("end_longitude"),
    endAccuracy: doublePrecision("end_accuracy"),
    endLocationTs: timestamp("end_location_ts", { withTimezone: true }),
    routeTrackingEnabled: boolean("route_tracking_enabled").notNull().default(false),
    attendanceRecordId: integer("attendance_record_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("mobile_att_sess_emp_date_idx").on(t.employeeId, t.workDate),
    index("mobile_att_sess_status_idx").on(t.status),
    index("mobile_att_sess_user_idx").on(t.userId),
  ],
);

export const mobileLocationPointsTable = pgTable(
  "mobile_location_points",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracy: doublePrecision("accuracy"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    sequenceNumber: integer("sequence_number").notNull().default(0),
    /** start | track | end */
    pointType: text("point_type").notNull().default("track"),
  },
  (t) => [
    index("mobile_loc_points_sess_idx").on(t.sessionId),
    index("mobile_loc_points_recorded_idx").on(t.recordedAt),
  ],
);

export const mobileAttendanceAuditLogsTable = pgTable(
  "mobile_attendance_audit_logs",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id"),
    employeeId: integer("employee_id"),
    actorId: integer("actor_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mobile_att_audit_emp_idx").on(t.employeeId),
    index("mobile_att_audit_created_idx").on(t.createdAt),
    index("mobile_att_audit_action_idx").on(t.action),
  ],
);
