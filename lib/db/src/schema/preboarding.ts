import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export type PreboardingStageState = {
  videoDone: boolean;
  slidesDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

export type PreboardingStagesMap = Record<string, PreboardingStageState>;

export type PreboardingQuestion = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
};

export const preboardingStagesTable = pgTable("preboarding_stages", {
  id: serial("id").primaryKey(),
  track: text("track").notNull(),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  youtubeId: text("youtube_id").notNull().default(""),
  videoDriveFileId: text("video_drive_file_id"),
  pdfUrl: text("pdf_url"),
  driveFileId: text("drive_file_id"),
  questionsJson: jsonb("questions_json").$type<PreboardingQuestion[]>().notNull().default([]),
  published: boolean("published").notNull().default(false),
  updatedById: integer("updated_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preboardingProgressTable = pgTable(
  "preboarding_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    track: text("track").notNull(),
    status: text("status").notNull().default("in_progress"),
    stagesJson: jsonb("stages_json").$type<PreboardingStagesMap>().notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("preboarding_progress_user_track_uidx").on(t.userId, t.track)],
);
