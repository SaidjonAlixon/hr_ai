import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  boolean,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";

export type AttestatsiyaQuestionRow = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
};

/** branch — faqat o‘z filiali zonasida; office — faqat asosiy ofis zonasida */
export type AttestatsiyaLocationMode = "branch" | "office";

export type AttestatsiyaAttemptStatus = "in_progress" | "submitted" | "expired" | "annulled";

export const attestatsiyaExamsTable = pgTable(
  "attestatsiya_exams",
  {
    id: serial("id").primaryKey(),
    track: text("track").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    questionsJson: jsonb("questions_json").$type<AttestatsiyaQuestionRow[]>().notNull().default([]),
    passScore: integer("pass_score").notNull().default(50),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    locationMode: text("location_mode").notNull().default("branch"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(true),
    showResult: boolean("show_result").notNull().default(true),
    published: boolean("published").notNull().default(true),
    createdById: integer("created_by_id"),
    updatedById: integer("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("attestatsiya_exams_track_idx").on(t.track, t.startsAt)],
);

export const attestatsiyaAttemptsTable = pgTable(
  "attestatsiya_attempts",
  {
    id: serial("id").primaryKey(),
    examId: integer("exam_id").notNull(),
    userId: integer("user_id").notNull(),
    attemptNo: integer("attempt_no").notNull().default(1),
    status: text("status").notNull().default("in_progress"),
    questionOrder: jsonb("question_order").$type<string[]>().notNull().default([]),
    answersJson: jsonb("answers_json").$type<Record<string, number>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    score: integer("score"),
    correct: integer("correct"),
    total: integer("total").notNull().default(0),
    passed: boolean("passed"),
    locationMode: text("location_mode").notNull().default("branch"),
    locationLabel: text("location_label"),
    branchId: integer("branch_id"),
    distanceM: integer("distance_m"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyM: integer("accuracy_m"),
    focusLost: integer("focus_lost").notNull().default(0),
    retakeAllowed: boolean("retake_allowed").notNull().default(false),
    retakeGrantedById: integer("retake_granted_by_id"),
    retakeGrantedAt: timestamp("retake_granted_at", { withTimezone: true }),
    annulledById: integer("annulled_by_id"),
    annulledAt: timestamp("annulled_at", { withTimezone: true }),
    annulReason: text("annul_reason"),
    finishedById: integer("finished_by_id"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("attestatsiya_attempts_exam_user_idx").on(t.examId, t.userId)],
);
