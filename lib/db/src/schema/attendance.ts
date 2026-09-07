import { pgTable, text, serial, timestamp, integer, uniqueIndex, index, doublePrecision, boolean, jsonb } from "drizzle-orm/pg-core";

/**
 * Kunlik davomat — kelish / ketish.
 * workDate: YYYY-MM-DD (Toshkent kuni) — smena boshlangan kun (tungi smena uchun ham).
 */
export const attendanceRecordsTable = pgTable(
  "attendance_records",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    userId: integer("user_id"),
    workDate: text("work_date").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    /** present | late | absent | incomplete | leave */
    status: text("status").notNull().default("present"),
    /** manual | punch | face | import */
    source: text("source").notNull().default("manual"),
    checkLatitude: doublePrecision("check_latitude"),
    checkLongitude: doublePrecision("check_longitude"),
    distanceMeters: integer("distance_meters"),
    notes: text("notes"),
    createdById: integer("created_by_id"),
    /** Snapshot: shu kunda ishlagan filial (mudir employee id) */
    resolvedBranchId: integer("resolved_branch_id"),
    resolvedBranchLabel: text("resolved_branch_label"),
    /** one | two | three | one+two | two+three ... */
    shiftPlan: text("shift_plan"),
    /** FACE_ID | QR — kelish usuli */
    checkInMethod: text("check_in_method"),
    /** FACE_ID | QR — ketish usuli */
    checkOutMethod: text("check_out_method"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("attendance_records_emp_date_uidx").on(t.employeeId, t.workDate),
    index("attendance_records_date_idx").on(t.workDate),
    index("attendance_records_employee_idx").on(t.employeeId),
  ],
);

/**
 * Filial davomat QR — hash + saqlangan payload (mudir/koordinator/admin ko‘radi).
 * Yangi QR yaratilganda eski revoked; payload shu paytgacha ko‘rinadi.
 */
export const branchAttendanceQrTable = pgTable(
  "branch_attendance_qr",
  {
    id: serial("id").primaryKey(),
    /** Ochiq identifikator (QR ichida) */
    qrId: text("qr_id").notNull(),
    /** Filial = mudir employee id */
    branchId: integer("branch_id").notNull(),
    branchLabel: text("branch_label"),
    /** sha256(hex) of raw token */
    tokenHash: text("token_hash").notNull(),
    /**
     * To‘liq QR matni (VMHR1…) — mudir/koordinator/admin uchun qayta ko‘rsatish.
     * Farmasevt/stajyor API orqali olmaydi.
     */
    tokenPayload: text("token_payload"),
    version: integer("version").notNull().default(1),
    /** active | revoked | expired */
    status: text("status").notNull().default("active"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("branch_attendance_qr_qr_id_uidx").on(t.qrId),
    index("branch_attendance_qr_branch_idx").on(t.branchId),
    index("branch_attendance_qr_status_idx").on(t.status),
  ],
);

/**
 * Ofis bo‘limi davomat QR — faqat shu department xodimlari punch qiladi.
 * GPS: asosiy ofis geofence.
 */
export const departmentAttendanceQrTable = pgTable(
  "department_attendance_qr",
  {
    id: serial("id").primaryKey(),
    qrId: text("qr_id").notNull(),
    departmentId: integer("department_id").notNull(),
    departmentLabel: text("department_label"),
    tokenHash: text("token_hash").notNull(),
    tokenPayload: text("token_payload"),
    version: integer("version").notNull().default(1),
    /** active | revoked | expired */
    status: text("status").notNull().default("active"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("department_attendance_qr_qr_id_uidx").on(t.qrId),
    index("department_attendance_qr_dept_idx").on(t.departmentId),
    index("department_attendance_qr_status_idx").on(t.status),
  ],
);

/** Davomat urinishlari audit log */
export const attendancePunchAuditTable = pgTable(
  "attendance_punch_audit",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id"),
    userId: integer("user_id"),
    branchId: integer("branch_id"),
    /** FACE_ID | QR */
    verificationMethod: text("verification_method"),
    /** in | out */
    action: text("action"),
    gpsResult: text("gps_result"),
    gpsDistance: integer("gps_distance"),
    faceResult: text("face_result"),
    qrResult: text("qr_result"),
    /** success | denied | error */
    finalResult: text("final_result").notNull(),
    failureReason: text("failure_reason"),
    deviceId: text("device_id"),
    ipAddress: text("ip_address"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_punch_audit_emp_idx").on(t.employeeId),
    index("attendance_punch_audit_created_idx").on(t.createdAt),
  ],
);

/**
 * Bir kundagi smena segmentlari (maks 2).
 * Haqiqiy check-in/out shu yerda — overlap merge attendance-engine da.
 */
export const attendanceShiftSegmentsTable = pgTable(
  "attendance_shift_segments",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    workDate: text("work_date").notNull(),
    /** one | two | three | office */
    shiftKey: text("shift_key").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    branchId: integer("branch_id"),
    branchLabel: text("branch_label"),
    status: text("status").notNull().default("open"),
    source: text("source").notNull().default("face"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("attendance_segments_emp_date_shift_uidx").on(t.employeeId, t.workDate, t.shiftKey),
    index("attendance_segments_emp_date_idx").on(t.employeeId, t.workDate),
  ],
);

/**
 * Filial biriktirish tarixi — eski oylar buzilmasin.
 * kind: substitute | temp_one_day | rotation | permanent
 * Ustuvorlik: substitute > temp_one_day > rotation > permanent
 */
export const employeeBranchAssignmentsTable = pgTable(
  "employee_branch_assignments",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    branchId: integer("branch_id").notNull(),
    branchLabel: text("branch_label"),
    kind: text("kind").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    replacesEmployeeId: integer("replaces_employee_id"),
    note: text("note"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("emp_branch_assign_emp_idx").on(t.employeeId),
    index("emp_branch_assign_range_idx").on(t.validFrom, t.validTo),
  ],
);

/**
 * Kunlik rejalashtirilgan smenalar (1 yoki 2 ta).
 * shiftKeys: ["one","two"] JSON
 */
export const employeeDayShiftPlansTable = pgTable(
  "employee_day_shift_plans",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    workDate: text("work_date").notNull(),
    shiftKeys: jsonb("shift_keys").$type<string[]>().notNull().default([]),
    createdById: integer("created_by_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("emp_day_shift_plans_uidx").on(t.employeeId, t.workDate)],
);

/** Davomat / smena to‘lov sozlamalari (bitta qator id=1) */
export const attendancePaySettingsTable = pgTable("attendance_pay_settings", {
  id: serial("id").primaryKey(),
  unpaidBreakOneMin: integer("unpaid_break_one_min").notNull().default(60),
  unpaidBreakTwoMin: integer("unpaid_break_two_min").notNull().default(0),
  unpaidBreakThreeMin: integer("unpaid_break_three_min").notNull().default(0),
  unpaidBreakOfficeMin: integer("unpaid_break_office_min").notNull().default(60),
  breakPaid: boolean("break_paid").notNull().default(false),
  nightStartHm: text("night_start_hm").notNull().default("22:00"),
  nightEndHm: text("night_end_hm").notNull().default("06:00"),
  nightCoefficient: doublePrecision("night_coefficient").notNull().default(1.5),
  dailyNormMinutes: integer("daily_norm_minutes").notNull().default(480),
  overtimeEnabled: boolean("overtime_enabled").notNull().default(true),
  graceMinutes: integer("grace_minutes").notNull().default(15),
  minRestHours: integer("min_rest_hours").notNull().default(12),
  maxShiftsPerDay: integer("max_shifts_per_day").notNull().default(2),
  /** Admin qo‘lda o‘zgartiradigan smena / ofis vaqtlari */
  shiftOneStartHm: text("shift_one_start_hm").notNull().default("08:00"),
  shiftOneEndHm: text("shift_one_end_hm").notNull().default("17:00"),
  shiftTwoStartHm: text("shift_two_start_hm").notNull().default("17:00"),
  shiftTwoEndHm: text("shift_two_end_hm").notNull().default("23:45"),
  shiftThreeStartHm: text("shift_three_start_hm").notNull().default("23:00"),
  shiftThreeEndHm: text("shift_three_end_hm").notNull().default("07:00"),
  shiftThreeOvernight: boolean("shift_three_overnight").notNull().default(true),
  officeStartHm: text("office_start_hm").notNull().default("09:00"),
  officeEndHm: text("office_end_hm").notNull().default("18:00"),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
