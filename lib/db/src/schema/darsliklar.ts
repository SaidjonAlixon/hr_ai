import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Darsliklar yo‘nalishi — har bir lavozimning alohida kursi */
export type DarslikTrack = "stajyor" | "farmasevt" | "mudir";

export type DarslikQuestionRow = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
};

export type DarslikLessonState = {
  videoDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

/** lessonId → holat */
export type DarslikLessonsMap = Record<string, DarslikLessonState>;

export const darslikSectionsTable = pgTable(
  "darslik_sections",
  {
    id: serial("id").primaryKey(),
    track: text("track").notNull(),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    coverUrl: text("cover_url").notNull().default(""),
    published: boolean("published").notNull().default(true),
    createdById: integer("created_by_id"),
    updatedById: integer("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("darslik_sections_track_pos_idx").on(t.track, t.position)],
);

export const darslikLessonsTable = pgTable(
  "darslik_lessons",
  {
    id: serial("id").primaryKey(),
    track: text("track").notNull(),
    sectionId: integer("section_id"),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    youtubeUrl: text("youtube_url").notNull().default(""),
    youtubeId: text("youtube_id").notNull().default(""),
    videoDriveFileId: text("video_drive_file_id"),
    pdfUrl: text("pdf_url"),
    driveFileId: text("drive_file_id"),
    questionsJson: jsonb("questions_json").$type<DarslikQuestionRow[]>().notNull().default([]),
    passScore: integer("pass_score").notNull().default(50),
    published: boolean("published").notNull().default(true),
    createdById: integer("created_by_id"),
    updatedById: integer("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("darslik_lessons_track_pos_idx").on(t.track, t.position),
    index("darslik_lessons_section_pos_idx").on(t.sectionId, t.position),
  ],
);

export const darslikProgressTable = pgTable(
  "darslik_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    track: text("track").notNull(),
    lessonsJson: jsonb("lessons_json").$type<DarslikLessonsMap>().notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("darslik_progress_user_track_uidx").on(t.userId, t.track)],
);
