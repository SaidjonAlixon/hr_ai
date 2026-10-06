import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Bloklash oynasi tarixi: kim, qachon, qaysi xodimga nimani o‘zgartirdi.
 * Ism/lavozim nusxa qilib saqlanadi — odam keyin o‘chirilsa ham tarix o‘qiladi.
 */
export const davomatAccessAuditTable = pgTable(
  "davomat_access_audit",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    actorLogin: text("actor_login"),
    /** method | zone | zone_unlock */
    action: text("action").notNull(),
    /** Ommaviy o‘zgarish — bitta bosishda yozilgan qatorlar bir xil batch_id oladi */
    batchId: text("batch_id"),
    batchSize: integer("batch_size"),
    targetUserId: integer("target_user_id").notNull(),
    targetName: text("target_name").notNull(),
    targetPosition: text("target_position"),
    targetLocation: text("target_location"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
  },
  (t) => [
    index("davomat_access_audit_created_idx").on(t.createdAt),
    index("davomat_access_audit_target_idx").on(t.targetUserId),
    index("davomat_access_audit_actor_idx").on(t.actorUserId),
  ],
);
