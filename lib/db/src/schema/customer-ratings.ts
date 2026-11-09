import { pgTable, text, serial, timestamp, integer, boolean, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

/** Filial mijoz baholash QR — har filial uchun alohida token */
export const customerRatingQrTable = pgTable(
  "customer_rating_qr",
  {
    id: serial("id").primaryKey(),
    /** Ochiq token (URL path) */
    token: text("token").notNull(),
    /** Filial = mudir employees.id */
    branchId: integer("branch_id").notNull(),
    branchLabel: text("branch_label"),
    /** active | blocked | revoked */
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdById: integer("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedByName: text("blocked_by_name"),
  },
  (t) => [
    uniqueIndex("customer_rating_qr_token_uidx").on(t.token),
    index("customer_rating_qr_branch_idx").on(t.branchId),
    index("customer_rating_qr_status_idx").on(t.status),
  ],
);

/** Bitta mijoz bahosi (bir yoki bir nechta xodim) */
export const customerRatingsTable = pgTable(
  "customer_ratings",
  {
    id: serial("id").primaryKey(),
    qrId: integer("qr_id"),
    branchId: integer("branch_id").notNull(),
    branchLabel: text("branch_label"),
    /** Asia/Tashkent YYYY-MM-DD */
    workDate: text("work_date").notNull(),
    shiftKey: text("shift_key"),
    /** 1–5 yulduz */
    stars: integer("stars").notNull(),
    /** a'lo | yaxshi | qoniqarli | yomon | juda_yomon */
    serviceQuality: text("service_quality").notNull(),
    /** xushmuomala | yaxshi | oddiy | qopol | juda_qopol */
    demeanor: text("demeanor").notNull(),
    comment: text("comment"),
    /** Faqat admin ko‘radi */
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    /** all_shift = smenadagi barchaga */
    targetMode: text("target_mode").notNull().default("single"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    fingerprint: text("fingerprint"),
    lang: text("lang").default("uz"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customer_ratings_branch_idx").on(t.branchId),
    index("customer_ratings_date_idx").on(t.workDate),
    index("customer_ratings_phone_idx").on(t.customerPhone),
    index("customer_ratings_created_idx").on(t.createdAt),
  ],
);

/** Baholangan xodim(lar) */
export const customerRatingTargetsTable = pgTable(
  "customer_rating_targets",
  {
    id: serial("id").primaryKey(),
    ratingId: integer("rating_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    employeeName: text("employee_name").notNull(),
    position: text("position"),
    shiftKey: text("shift_key"),
  },
  (t) => [
    index("customer_rating_targets_rating_idx").on(t.ratingId),
    index("customer_rating_targets_emp_idx").on(t.employeeId),
  ],
);

/** Muhim harakatlar audit */
export const customerRatingAuditTable = pgTable(
  "customer_rating_audit",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name"),
    branchId: integer("branch_id"),
    ratingId: integer("rating_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_rating_audit_created_idx").on(t.createdAt)],
);
