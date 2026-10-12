import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";

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

export type KirishQuestionRow = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
};

export type KirishSlidePdfRow = {
  id: string;
  title: string;
  url: string;
  driveFileId: string;
};

export const kirishVideosTable = pgTable(
  "kirish_videos",
  {
    id: serial("id").primaryKey(),
    stage: integer("stage").notNull(),
    /** Bo‘sh bo‘lsa — standart (kod ichidagi) sarlavha */
    title: text("title"),
    subtitle: text("subtitle"),
    /** Trener qo‘shgan dars (standart 8 bosqichdan tashqari) */
    isCustom: boolean("is_custom").notNull().default(false),
    /** Qo‘shimcha PDF slaydlar (asosiy pdf_url dan keyin) */
    slidesJson: jsonb("slides_json").$type<KirishSlidePdfRow[]>().notNull().default([]),
    youtubeUrl: text("youtube_url").notNull().default(""),
    youtubeId: text("youtube_id").notNull().default(""),
    /** Google Drive video (bosqich videosi) */
    videoDriveFileId: text("video_drive_file_id"),
    pdfUrl: text("pdf_url"),
    driveFileId: text("drive_file_id"),
    questionsJson: jsonb("questions_json").$type<KirishQuestionRow[]>().notNull().default([]),
    updatedById: integer("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("kirish_videos_stage_uidx").on(t.stage)],
);
