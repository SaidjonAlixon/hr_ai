import { pgTable, text, serial, timestamp, integer, jsonb, doublePrecision, boolean } from "drizzle-orm/pg-core";

export type RevisionInventoryLine = {
  sku?: string;
  barcode?: string;
  name?: string;
  category?: string;
  bookQty?: number;
  actualQty?: number;
  diffQty?: number;
  costPrice?: number;
  salePrice?: number;
  diffCost?: number;
  diffSale?: number;
  reasonCode?: string;
  note?: string;
  photoUrl?: string;
  expiryDate?: string;
};

export type RevisionCashDenom = {
  currency: string;
  label: string;
  value: number;
  count: number;
};

export type RevisionPhoto = { url: string; caption?: string; at?: string };

export const revisionDocumentsTable = pgTable("revision_documents", {
  id: serial("id").primaryKey(),
  docNo: text("doc_no").notNull(),
  /** assignment | inventory_act | cash_act | cash_receipt | cash_handover | goods_transfer | explanation | protocol */
  docType: text("doc_type").notNull(),
  /** planned | en_route | inspecting | reconciling | signed | accounting_approved | closed | awaiting_explanation | sb_review | recovery | storno */
  status: text("status").notNull().default("planned"),
  branchName: text("branch_name"),
  plannedDate: text("planned_date"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdById: integer("created_by_id"),
  revizorId: integer("revizor_id"),
  responsibleName: text("responsible_name"),
  parentId: integer("parent_id"),
  stornoOfId: integer("storno_of_id"),
  checkLat: doublePrecision("check_lat"),
  checkLng: doublePrecision("check_lng"),
  otpCode: text("otp_code"),
  signedByReviziyaHeadId: integer("signed_by_reviziya_head_id"),
  signedByAccountantId: integer("signed_by_accountant_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  lines: jsonb("lines").$type<RevisionInventoryLine[]>().notNull().default([]),
  denoms: jsonb("denoms").$type<RevisionCashDenom[]>().notNull().default([]),
  photos: jsonb("photos").$type<RevisionPhoto[]>().notNull().default([]),
  shortageAmount: doublePrecision("shortage_amount").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const revisionInTransitTable = pgTable("revision_in_transit", {
  id: serial("id").primaryKey(),
  receiptDocId: integer("receipt_doc_id").notNull(),
  handoverDocId: integer("handover_doc_id"),
  revizorId: integer("revizor_id").notNull(),
  branchName: text("branch_name"),
  amount: doublePrecision("amount").notNull().default(0),
  currency: text("currency").notNull().default("UZS"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  handedAt: timestamp("handed_at", { withTimezone: true }),
  /** open | handed | overdue */
  status: text("status").notNull().default("open"),
  routeNote: text("route_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const revisionDictsTable = pgTable("revision_dicts", {
  id: serial("id").primaryKey(),
  /** category | violation | shortage_reason | product_category */
  kind: text("kind").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revisionWatchlistTable = pgTable("revision_watchlist", {
  id: serial("id").primaryKey(),
  branchName: text("branch_name").notNull(),
  reason: text("reason").notNull(),
  consecutiveCount: integer("consecutive_count").notNull().default(2),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revisionAuditLogTable = pgTable("revision_audit_log", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id"),
  visitId: integer("visit_id"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  userId: integer("user_id"),
  userName: text("user_name"),
  userRole: text("user_role"),
  action: text("action").notNull(),
  detail: text("detail"),
  reason: text("reason"),
  oldValue: jsonb("old_value").$type<Record<string, unknown> | null>(),
  newValue: jsonb("new_value").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Filial reviziya sikli / tashriflari.
 * Har bir yozuv alohida moliyaviy natija — eski undirish yangi reviziyaga o‘tmaydi.
 * branchId = employees.id (orgRole=manager).
 */
export type RevisionExtraDoc = { url: string; name?: string };

export const revisionVisitsTable = pgTable("revision_visits", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  branchName: text("branch_name").notNull(),
  /** Rejalashtirilgan / o‘tkazilgan sana YYYY-MM-DD */
  revisionDate: text("revision_date"),
  scheduledDate: text("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedById: integer("completed_by_id"),
  durationMinutes: integer("duration_minutes"),
  /** users.id — biriktirilgan revizor */
  assignedEmployeeId: integer("assigned_employee_id"),
  assignedEmployeeName: text("assigned_employee_name"),
  /** ASSIGNED | ACCEPTED | IN_PROGRESS | COMPLETED | CANCELLED */
  workflowStatus: text("workflow_status").notNull().default("ASSIGNED"),
  /** normal | high | urgent */
  priority: text("priority").notNull().default("normal"),
  /** so‘m, butun son */
  shortageAmount: integer("shortage_amount").notNull().default(0),
  excessAmount: integer("excess_amount").notNull().default(0),
  collectedAmount: integer("collected_amount").notNull().default(0),
  remainingAmount: integer("remaining_amount").notNull().default(0),
  actNumber: text("act_number"),
  actUrl: text("act_url"),
  receiptUrl: text("receipt_url"),
  extraDocs: jsonb("extra_docs").$type<RevisionExtraDoc[]>().notNull().default([]),
  notes: text("notes"),
  responsibleName: text("responsible_name"),
  /** Avtomatik hisoblangan keyingi sana */
  nextRevisionDate: text("next_revision_date"),
  /** Faqat override permission bilan */
  nextRevisionDateOverride: text("next_revision_date_override"),
  /** 3 | 4 | 6 — SIKL hisobi uchun */
  cycleMonths: integer("cycle_months"),
  createdById: integer("created_by_id"),
  updatedById: integer("updated_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
