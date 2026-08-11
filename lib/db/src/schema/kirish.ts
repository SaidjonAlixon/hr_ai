import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export type KirishStageState = {
  videoDone: boolean;
  slidesDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

export type KirishStagesMap = Record<string, KirishStageState>;

export const kirishProgressTable = pgTable(
  "kirish_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    currentStage: integer("current_stage").notNull().default(1),
    status: text("status").notNull().default("in_progress"), // in_progress | ready_for_hire | hired
    stagesJson: jsonb("stages_json").$type<KirishStagesMap>().notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("kirish_progress_user_uidx").on(t.userId)],
);
