/**
 * Darsliklar — stajyor / farmasevt / mudir uchun alohida kurslar.
 * Mantiq «Kirish» bilan bir xil: video (100%) → slayd (PDF) → test (≥ o‘tish bali) → keyingi dars ochiladi.
 * Darslarni admin, direktor va trener joylaydi.
 */
import { Router, type IRouter, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  darslikLessonsTable,
  darslikProgressTable,
  darslikSectionsTable,
  usersTable,
  type DarslikLessonState,
  type DarslikLessonsMap,
  type DarslikQuestionRow,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canManageDarsliklar, darslikTrackForRole } from "../lib/roles";
import { parseYoutubeId } from "../lib/youtube-id";
import { parseDriveFileId } from "../lib/drive-id";

const router: IRouter = Router();

const TRACKS = ["stajyor", "farmasevt", "mudir"] as const;
type Track = (typeof TRACKS)[number];

const TRACK_LABEL: Record<Track, string> = {
  stajyor: "Stajyor",
  farmasevt: "Farmasevt",
  mudir: "Mudir",
};

const DEFAULT_PASS_SCORE = 50;

type LessonRow = typeof darslikLessonsTable.$inferSelect;
type SectionRow = typeof darslikSectionsTable.$inferSelect;

function parseTrack(raw: unknown): Track | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (TRACKS as readonly string[]).includes(v) ? (v as Track) : null;
}

function emptyState(): DarslikLessonState {
  return { videoDone: false, score: null, attempts: 0, passed: false, passedAt: null };
}

function hasVideo(l: LessonRow): boolean {
  return Boolean((l.youtubeId || "").trim() || l.videoDriveFileId);
}

function videoKind(l: LessonRow): "youtube" | "drive" | null {
  if ((l.youtubeId || "").trim()) return "youtube";
  if (l.videoDriveFileId) return "drive";
  return null;
}

async function loadSections(track: Track, opts?: { includeDrafts?: boolean }) {
  return db
    .select()
    .from(darslikSectionsTable)
    .where(
      opts?.includeDrafts
        ? eq(darslikSectionsTable.track, track)
        : and(eq(darslikSectionsTable.track, track), eq(darslikSectionsTable.published, true)),
    )
    .orderBy(asc(darslikSectionsTable.position), asc(darslikSectionsTable.id));
}

async function loadLessons(track: Track, opts?: { includeDrafts?: boolean }) {
  return db
    .select()
    .from(darslikLessonsTable)
    .where(
      opts?.includeDrafts
        ? eq(darslikLessonsTable.track, track)
        : and(eq(darslikLessonsTable.track, track), eq(darslikLessonsTable.published, true)),
    )
    .orderBy(asc(darslikLessonsTable.position), asc(darslikLessonsTable.id));
}

async function getOrCreateProgress(userId: number, track: Track) {
  const [existing] = await db
    .select()
    .from(darslikProgressTable)
    .where(and(eq(darslikProgressTable.userId, userId), eq(darslikProgressTable.track, track)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(darslikProgressTable)
    .values({ userId, track, lessonsJson: {} })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(darslikProgressTable)
    .where(and(eq(darslikProgressTable.userId, userId), eq(darslikProgressTable.track, track)))
    .limit(1);
  return again!;
}

/** Bo‘limlar ketma-ket: oldingi bo‘limdagi darslar o‘tilmasa keyingisi yopiq */
function lockMap(sections: SectionRow[], lessons: LessonRow[], map: DarslikLessonsMap, preview: boolean) {
  const lessonsLocked = new Map<number, boolean>();
  const sectionsLocked = new Map<number, boolean>();
  let blocked = false;
  for (const section of sections) {
    sectionsLocked.set(section.id, preview ? false : blocked);
    const list = lessons.filter((l) => l.sectionId === section.id);
    for (const l of list) {
      lessonsLocked.set(l.id, preview ? false : blocked);
      if (!preview && !map[String(l.id)]?.passed) blocked = true;
    }
  }
  return { lessonsLocked, sectionsLocked };
}

function summarize(lessons: LessonRow[], map: DarslikLessonsMap) {
  const total = lessons.length;
  const passed = lessons.filter((l) => map[String(l.id)]?.passed).length;
  const scores = lessons
    .map((l) => map[String(l.id)]?.score)
    .filter((s): s is number => typeof s === "number");
  return {
    total,
    passed,
    percent: total ? Math.round((passed / total) * 100) : 0,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    completed: total > 0 && passed === total,
  };
}

function publicLesson(
  l: LessonRow,
  index: number,
  state: DarslikLessonState,
  locked: boolean,
) {
  return {
    id: l.id,
    number: index + 1,
    title: l.title,
    description: l.description,
    videoKind: videoKind(l),
    youtubeId: (l.youtubeId || "").trim() || null,
    videoDriveFileId: l.videoDriveFileId || null,
    driveFileId: l.driveFileId || null,
    passScore: l.passScore || DEFAULT_PASS_SCORE,
    questions: (l.questionsJson || []).map((q) => ({ id: q.id, text: q.text, options: q.options })),
    state,
    locked,
  };
}

function scoreAnswers(questions: DarslikQuestionRow[], answers: Record<string, number>, passScore: number) {
  const total = questions.length;
  let correct = 0;
  for (const q of questions) {
    const given = Number(answers[q.id]);
    if (Number.isInteger(given) && given === Number(q.correctIndex)) correct += 1;
  }
  const score = total ? Math.round((correct / total) * 100) : 100;
  return { score, correct, total, passed: score >= passScore };
}

function parseQuestions(raw: unknown): DarslikQuestionRow[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "Test savollari noto‘g‘ri" };
  const out: DarslikQuestionRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i] as Record<string, unknown>;
    const text = String(q?.text ?? "").trim();
    const options = Array.isArray(q?.options)
      ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean)
      : [];
    const correctIndex = Number(q?.correctIndex);
    if (!text) return { error: `${i + 1}-savol matnini yozing` };
    if (options.length < 2) return { error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin` };
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { error: `${i + 1}-savolda to‘g‘ri javobni belgilang` };
    }
    const idRaw = String(q?.id ?? "").trim();
    out.push({ id: idRaw || `q-${i + 1}-${Date.now()}`, text, options, correctIndex });
  }
  return out;
}

type LessonInput = {
  title: string;
  description: string;
  youtubeUrl: string;
  youtubeId: string;
  videoDriveFileId: string | null;
  pdfUrl: string | null;
  driveFileId: string | null;
  questionsJson: DarslikQuestionRow[];
  passScore: number;
  published: boolean;
};

function parseLessonBody(body: Record<string, unknown> | undefined): LessonInput | { error: string } {
  const title = String(body?.title ?? "").trim();
  if (!title) return { error: "Dars nomini yozing" };
  const description = String(body?.description ?? "").trim();

  const rawVideo = String(body?.videoUrl ?? "").trim();
  const videoDriveFileId = rawVideo ? parseDriveFileId(rawVideo) : null;
  const youtubeId = rawVideo && !videoDriveFileId ? parseYoutubeId(rawVideo) || "" : "";
  if (rawVideo && !videoDriveFileId && !youtubeId) {
    return { error: "YouTube yoki Google Drive video havolasi noto‘g‘ri" };
  }

  const rawPdf = String(body?.pdfUrl ?? "").trim();
  const driveFileId = rawPdf ? parseDriveFileId(rawPdf) : null;
  if (rawPdf && !driveFileId) return { error: "Slayd (PDF) uchun Google Drive havolasi noto‘g‘ri" };

  const qs = parseQuestions(body?.questions);
  if (!Array.isArray(qs)) return qs;

  if (!youtubeId && !videoDriveFileId && !driveFileId && qs.length === 0 && body?.published !== false) {
    return { error: "Video, slayd (PDF) yoki kamida bitta test savolini qo‘shing" };
  }

  const ps = Number(body?.passScore);
  const passScore = Number.isFinite(ps) ? Math.min(100, Math.max(1, Math.round(ps))) : DEFAULT_PASS_SCORE;

  return {
    title,
    description,
    youtubeUrl: youtubeId
      ? `https://www.youtube.com/watch?v=${youtubeId}`
      : videoDriveFileId
        ? `https://drive.google.com/file/d/${videoDriveFileId}/view`
        : "",
    youtubeId,
    videoDriveFileId,
    pdfUrl: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
    driveFileId,
    questionsJson: qs,
    passScore,
    published: body?.published === undefined ? true : Boolean(body.published),
  };
}

function manageLesson(l: LessonRow) {
  return {
    id: l.id,
    track: l.track,
    sectionId: l.sectionId,
    position: l.position,
    title: l.title,
    description: l.description,
    videoUrl: l.youtubeUrl || "",
    videoKind: videoKind(l),
    youtubeId: (l.youtubeId || "").trim() || null,
    videoDriveFileId: l.videoDriveFileId || null,
    pdfUrl: l.pdfUrl || "",
    driveFileId: l.driveFileId || null,
    questions: l.questionsJson || [],
    passScore: l.passScore || DEFAULT_PASS_SCORE,
    published: l.published,
    updatedAt: l.updatedAt.toISOString(),
  };
}

function requireManager(req: AuthRequest, res: Response): boolean {
  if (!canManageDarsliklar(req.userRole)) {
    res.status(403).json({ error: "Faqat admin, direktor yoki trener" });
    return false;
  }
  return true;
}

/** O‘quvchi yo‘nalishi; boshqaruvchi `?track=` bilan istalganini ko‘radi (preview) */
function resolveLearnerTrack(req: AuthRequest, res: Response): { track: Track; preview: boolean } | null {
  const own = darslikTrackForRole(req.userRole);
  const manager = canManageDarsliklar(req.userRole);
  const asked = parseTrack(req.query.track ?? req.body?.track);
  if (manager && asked && asked !== own) return { track: asked, preview: true };
  if (own) return { track: own, preview: false };
  if (manager) return { track: asked || "stajyor", preview: true };
  res.status(403).json({ error: "Darsliklar faqat stajyor, farmasevt va mudir uchun" });
  return null;
}

async function buildMePayload(userId: number, track: Track, preview: boolean) {
  const sections = await loadSections(track);
  const sectionIds = new Set(sections.map((s) => s.id));
  const lessons = (await loadLessons(track)).filter((l) => l.sectionId != null && sectionIds.has(l.sectionId));
  const progress = preview ? null : await getOrCreateProgress(userId, track);
  const map: DarslikLessonsMap = (progress?.lessonsJson as DarslikLessonsMap) || {};
  const locked = lockMap(sections, lessons, map, preview);
  const flat = sections.flatMap((s) => lessons.filter((l) => l.sectionId === s.id));
  return {
    track,
    trackLabel: TRACK_LABEL[track],
    preview,
    sections: sections.map((s) => {
      const list = lessons.filter((l) => l.sectionId === s.id);
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        coverUrl: s.coverUrl || "",
        locked: Boolean(locked.sectionsLocked.get(s.id)),
        summary: summarize(list, map),
        lessons: list.map((l, i) =>
          publicLesson(l, i, map[String(l.id)] || emptyState(), Boolean(locked.lessonsLocked.get(l.id))),
        ),
      };
    }),
    lessons: flat.map((l, i) =>
      publicLesson(l, i, map[String(l.id)] || emptyState(), Boolean(locked.lessonsLocked.get(l.id))),
    ),
    summary: {
      ...summarize(flat, map),
      completedAt: progress?.completedAt ? progress.completedAt.toISOString() : null,
    },
  };
}

async function saveProgress(
  progressId: number,
  map: DarslikLessonsMap,
  lessons: LessonRow[],
  completedAt: Date | null,
) {
  const done = summarize(lessons, map).completed;
  await db
    .update(darslikProgressTable)
    .set({
      lessonsJson: map,
      completedAt: done ? completedAt ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(darslikProgressTable.id, progressId));
}

/** O‘quvchining shu darsga kirishi — yo‘nalish, ochiqlik */
async function learnerLessonContext(req: AuthRequest, res: Response) {
  const own = darslikTrackForRole(req.userRole);
  if (!own) {
    res.status(403).json({ error: "Darsliklar faqat stajyor, farmasevt va mudir uchun" });
    return null;
  }
  const id = Number(req.params.id);
  const lessons = await loadLessons(own);
  const sections = await loadSections(own);
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson || !sections.some((s) => s.id === lesson.sectionId)) {
    res.status(404).json({ error: "Dars topilmadi" });
    return null;
  }
  const progress = await getOrCreateProgress(req.userId!, own);
  const map: DarslikLessonsMap = { ...((progress.lessonsJson as DarslikLessonsMap) || {}) };
  const visible = lessons.filter((l) => sections.some((s) => s.id === l.sectionId));
  if (lockMap(sections, visible, map, false).lessonsLocked.get(id)) {
    res.status(400).json({ error: "Avval oldingi darsni yakunlang" });
    return null;
  }
  return { track: own, lessons: visible, lesson, progress, map };
}

router.get("/darsliklar/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const t = resolveLearnerTrack(req, res);
  if (!t) return;
  res.json(await buildMePayload(req.userId!, t.track, t.preview));
});

router.post(
  "/darsliklar/me/lessons/:id/complete-video",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const ctx = await learnerLessonContext(req, res);
    if (!ctx) return;
    const key = String(ctx.lesson.id);
    const st = ctx.map[key] || emptyState();
    const noTest = (ctx.lesson.questionsJson || []).length === 0;
    ctx.map[key] = {
      ...st,
      videoDone: true,
      ...(noTest && !st.passed
        ? { passed: true, score: 100, passedAt: new Date().toISOString() }
        : {}),
    };
    await saveProgress(ctx.progress.id, ctx.map, ctx.lessons, ctx.progress.completedAt);
    res.json(await buildMePayload(req.userId!, ctx.track, false));
  },
);

router.post(
  "/darsliklar/me/lessons/:id/submit-test",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const ctx = await learnerLessonContext(req, res);
    if (!ctx) return;
    const questions = ctx.lesson.questionsJson || [];
    if (!questions.length) {
      res.status(400).json({ error: "Bu darsda test yo‘q" });
      return;
    }
    const key = String(ctx.lesson.id);
    const st = ctx.map[key] || emptyState();
    const needsVideo = hasVideo(ctx.lesson);
    if (needsVideo && !st.videoDone) {
      res.status(400).json({ error: "Avval videoni oxirigacha ko‘ring" });
      return;
    }
    const answers = (req.body?.answers || {}) as Record<string, number>;
    const unanswered = questions.filter((q) => !Number.isInteger(Number(answers[q.id])));
    if (unanswered.length) {
      res.status(400).json({ error: "Barcha savollarga javob bering" });
      return;
    }
    const passScore = ctx.lesson.passScore || DEFAULT_PASS_SCORE;
    const result = scoreAnswers(questions, answers, passScore);
    ctx.map[key] = {
      videoDone: result.passed || st.passed ? true : !needsVideo,
      score: st.passed ? Math.max(st.score ?? 0, result.score) : result.score,
      attempts: st.attempts + 1,
      passed: st.passed || result.passed,
      passedAt: st.passed ? st.passedAt : result.passed ? new Date().toISOString() : null,
    };
    await saveProgress(ctx.progress.id, ctx.map, ctx.lessons, ctx.progress.completedAt);
    res.json({
      result: { ...result, passScore },
      ...(await buildMePayload(req.userId!, ctx.track, false)),
    });
  },
);

// ——— Darslik joylash (admin / direktor / trener) ———

router.get("/darsliklar/manage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.query.track) || "stajyor";
  const lessons = await loadLessons(track, { includeDrafts: true });
  const sections = await loadSections(track, { includeDrafts: true });

  const counts = await Promise.all(
    TRACKS.map(async (t) => {
      const rows = await db
        .select({ id: darslikLessonsTable.id, published: darslikLessonsTable.published })
        .from(darslikLessonsTable)
        .where(eq(darslikLessonsTable.track, t));
      const secs = await db
        .select({ id: darslikSectionsTable.id })
        .from(darslikSectionsTable)
        .where(eq(darslikSectionsTable.track, t));
      return [t, { total: rows.length, published: rows.filter((r) => r.published).length, sections: secs.length }] as const;
    }),
  );

  res.json({
    track,
    trackLabel: TRACK_LABEL[track],
    tracks: TRACKS.map((t) => ({ key: t, label: TRACK_LABEL[t], ...Object.fromEntries(counts)[t] })),
    sections: sections.map((s) => ({
      id: s.id,
      track: s.track,
      position: s.position,
      title: s.title,
      description: s.description,
      coverUrl: s.coverUrl || "",
      published: s.published,
      lessonCount: lessons.filter((l) => l.sectionId === s.id).length,
      publishedCount: lessons.filter((l) => l.sectionId === s.id && l.published).length,
    })),
    lessons: lessons.map(manageLesson),
  });
});

router.post("/darsliklar/manage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalishni tanlang (stajyor / farmasevt / mudir)" });
    return;
  }
  const input = parseLessonBody(req.body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const sectionId = Number(req.body?.sectionId);
  const [section] = await db.select().from(darslikSectionsTable).where(eq(darslikSectionsTable.id, sectionId)).limit(1);
  if (!section || section.track !== track) {
    res.status(400).json({ error: "Avval bo‘limni tanlang" });
    return;
  }
  const existing = (await loadLessons(track, { includeDrafts: true })).filter((l) => l.sectionId === sectionId);
  const position = existing.length ? Math.max(...existing.map((l) => l.position)) + 1 : 1;
  const [created] = await db
    .insert(darslikLessonsTable)
    .values({
      track,
      sectionId,
      position,
      ...input,
      createdById: req.userId ?? null,
      updatedById: req.userId ?? null,
    })
    .returning();
  res.status(201).json({ lesson: manageLesson(created!) });
});

router.put("/darsliklar/manage/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const [existing] = await db
    .select()
    .from(darslikLessonsTable)
    .where(eq(darslikLessonsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Dars topilmadi" });
    return;
  }
  const input = parseLessonBody(req.body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const [updated] = await db
    .update(darslikLessonsTable)
    .set({ ...input, updatedById: req.userId ?? null, updatedAt: new Date() })
    .where(eq(darslikLessonsTable.id, id))
    .returning();
  res.json({ lesson: manageLesson(updated!) });
});

router.patch(
  "/darsliklar/manage/:id/publish",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManager(req, res)) return;
    const id = Number(req.params.id);
    const [updated] = await db
      .update(darslikLessonsTable)
      .set({ published: Boolean(req.body?.published), updatedById: req.userId ?? null, updatedAt: new Date() })
      .where(eq(darslikLessonsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Dars topilmadi" });
      return;
    }
    res.json({ lesson: manageLesson(updated) });
  },
);

router.delete("/darsliklar/manage/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const deleted = await db
    .delete(darslikLessonsTable)
    .where(eq(darslikLessonsTable.id, id))
    .returning({ id: darslikLessonsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Dars topilmadi" });
    return;
  }
  res.json({ ok: true });
});

router.post("/darsliklar/manage/reorder", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  const sectionId = Number(req.body?.sectionId);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!track || !ids.length) {
    res.status(400).json({ error: "Tartib noto‘g‘ri" });
    return;
  }
  const lessons = await loadLessons(track, { includeDrafts: true });
  const pool = Number.isInteger(sectionId) && sectionId > 0 ? lessons.filter((l) => l.sectionId === sectionId) : lessons;
  const known = new Set(pool.map((l) => l.id));
  if (ids.length !== pool.length || ids.some((id: number) => !known.has(id))) {
    res.status(400).json({ error: "Darslar ro‘yxati eskirgan — sahifani yangilang" });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(darslikLessonsTable)
        .set({ position: i + 1 })
        .where(eq(darslikLessonsTable.id, ids[i]));
    }
  });
  const fresh = await loadLessons(track, { includeDrafts: true });
  res.json({ lessons: fresh.map(manageLesson) });
});

/** Natijalar: shu lavozimdagi faol xodimlar va har bir darsdagi holati */
router.get("/darsliklar/manage/results", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.query.track) || "stajyor";
  const sections = await loadSections(track, { includeDrafts: true });
  const lessons = await loadLessons(track);
  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(and(eq(usersTable.role, track), inArray(usersTable.status, ["active", "on_leave"])))
    .orderBy(asc(usersTable.fullName));
  const progressRows = users.length
    ? await db
        .select()
        .from(darslikProgressTable)
        .where(
          and(
            eq(darslikProgressTable.track, track),
            inArray(
              darslikProgressTable.userId,
              users.map((u) => u.id),
            ),
          ),
        )
    : [];
  const byUser = new Map(progressRows.map((p) => [p.userId, p]));

  res.json({
    track,
    sections: sections.map((s) => ({ id: s.id, title: s.title, coverUrl: s.coverUrl || "" })),
    lessons: lessons.map((l, i) => ({ id: l.id, number: i + 1, title: l.title, sectionId: l.sectionId })),
    learners: users.map((u) => {
      const p = byUser.get(u.id);
      const map = (p?.lessonsJson as DarslikLessonsMap) || {};
      const sum = summarize(lessons, map);
      return {
        userId: u.id,
        fullName: u.fullName,
        started: Boolean(p),
        ...sum,
        completedAt: sum.completed && p?.completedAt ? p.completedAt.toISOString() : null,
        lastActivityAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
        lessons: lessons.map((l) => {
          const s = map[String(l.id)];
          return {
            lessonId: l.id,
            passed: Boolean(s?.passed),
            score: s?.score ?? null,
            attempts: s?.attempts ?? 0,
          };
        }),
      };
    }),
  });
});

function parseCover(raw: unknown): string | { error: string } {
  const url = String(raw ?? "").trim();
  if (!url) return "";
  if (url.length > 2000) return { error: "Muqova manzili juda uzun" };
  if (url.startsWith("/api/uploads/")) return url;
  if (/^https:\/\/.+/i.test(url)) return url;
  return { error: "Muqova rasmini yuklang" };
}

router.post("/darsliklar/manage/sections", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  const title = String(req.body?.title ?? "").trim().slice(0, 140);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalishni tanlang" });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "Bo‘lim nomini yozing" });
    return;
  }
  const cover = parseCover(req.body?.coverUrl);
  if (typeof cover !== "string") {
    res.status(400).json({ error: cover.error });
    return;
  }
  const existing = await loadSections(track, { includeDrafts: true });
  const position = existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 1;
  const [created] = await db
    .insert(darslikSectionsTable)
    .values({
      track,
      position,
      title,
      description: String(req.body?.description ?? "").trim().slice(0, 600),
      coverUrl: cover,
      published: req.body?.published === undefined ? true : Boolean(req.body.published),
      createdById: req.userId ?? null,
      updatedById: req.userId ?? null,
    })
    .returning();
  res.status(201).json({ section: created });
});

router.put("/darsliklar/manage/sections/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const title = String(req.body?.title ?? "").trim().slice(0, 140);
  if (!title) {
    res.status(400).json({ error: "Bo‘lim nomini yozing" });
    return;
  }
  const cover = parseCover(req.body?.coverUrl);
  if (typeof cover !== "string") {
    res.status(400).json({ error: cover.error });
    return;
  }
  const [updated] = await db
    .update(darslikSectionsTable)
    .set({
      title,
      description: String(req.body?.description ?? "").trim().slice(0, 600),
      coverUrl: cover,
      published: req.body?.published === undefined ? true : Boolean(req.body.published),
      updatedById: req.userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(darslikSectionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Bo‘lim topilmadi" });
    return;
  }
  res.json({ section: updated });
});

router.delete("/darsliklar/manage/sections/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const lessons = await db
    .select({ id: darslikLessonsTable.id })
    .from(darslikLessonsTable)
    .where(eq(darslikLessonsTable.sectionId, id))
    .limit(1);
  if (lessons.length) {
    res.status(409).json({ error: "Avval shu bo‘limdagi darslarni o‘chiring" });
    return;
  }
  const deleted = await db.delete(darslikSectionsTable).where(eq(darslikSectionsTable.id, id)).returning({ id: darslikSectionsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Bo‘lim topilmadi" });
    return;
  }
  res.json({ ok: true });
});

router.post("/darsliklar/manage/sections/reorder", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!track || !ids.length) {
    res.status(400).json({ error: "Tartib noto‘g‘ri" });
    return;
  }
  const sections = await loadSections(track, { includeDrafts: true });
  const known = new Set(sections.map((s) => s.id));
  if (ids.length !== sections.length || ids.some((id: number) => !known.has(id))) {
    res.status(400).json({ error: "Bo‘limlar ro‘yxati eskirgan — sahifani yangilang" });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(darslikSectionsTable).set({ position: i + 1 }).where(eq(darslikSectionsTable.id, ids[i]));
    }
  });
  res.json({ ok: true });
});

export default router;
