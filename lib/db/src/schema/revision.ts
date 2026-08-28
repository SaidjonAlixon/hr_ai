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
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
