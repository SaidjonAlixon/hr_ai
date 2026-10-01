import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  preboardingProgressTable,
  preboardingStagesTable,
  usersTable,
  type PreboardingQuestion,
  type PreboardingStageState,
  type PreboardingStagesMap,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canManageOnboardingContent } from "../lib/roles";
import { parseYoutubeId } from "../lib/youtube-id";
import { parseDriveFileId } from "../lib/drive-id";
import { ensurePreboardingSchema } from "../lib/ensure-schema";

const router: IRouter = Router();

router.use("/preboarding-kurs", async (_req, _res, next) => {
  try {
    await ensurePreboardingSchema();
    next();
  } catch (err) {
    next(err);
  }
});

const PASS = 50;
const TRACKS = new Set(["farmasevt", "mudir"]);

function canManage(role?: string | null) {
  return canManageOnboardingContent(role) || role === "trainer";
}

function trackOf(role?: string | null) {
  return role === "farmasevt" || role === "mudir" ? role : null;
}

function emptyState(): PreboardingStageState {
  return { videoDone: false, slidesDone: false, score: null, attempts: 0, passed: false, passedAt: null };
}

function cleanQuestions(raw: unknown): PreboardingQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((q, i) => {
      const text = String((q as { text?: unknown })?.text || "").trim().slice(0, 500);
      const options = Array.isArray((q as { options?: unknown }).options)
        ? (q as { options: unknown[] }).options.map((o) => String(o || "").trim().slice(0, 200)).filter(Boolean).slice(0, 6)
        : [];
      const correctIndex = Number((q as { correctIndex?: unknown }).correctIndex);
      return {
        id: String((q as { id?: unknown }).id || `q-${i + 1}`).slice(0, 40),
        text,
        options,
        correctIndex: Number.isInteger(correctIndex) ? correctIndex : 0,
      };
    })
    .filter((q) => q.text && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length);
}

function publicQuestion(q: PreboardingQuestion) {
  return { id: q.id, text: q.text, options: q.options };
}

function score(questions: PreboardingQuestion[], answers: Record<string, number>) {
  const total = questions.length;
  let correct = 0;
  for (const q of questions) {
    if (Number(answers[q.id]) === q.correctIndex) correct += 1;
  }
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { score: percent, correct, total, passed: total === 0 || percent >= PASS };
}

async function loadProgress(userId: number, track: string) {
  const [row] = await db
    .select()
    .from(preboardingProgressTable)
    .where(and(eq(preboardingProgressTable.userId, userId), eq(preboardingProgressTable.track, track)))
    .limit(1);
  return row;
}

async function saveProgress(
  userId: number,
  track: string,
  stages: PreboardingStagesMap,
  status: string,
) {
  const now = new Date();
  const existing = await loadProgress(userId, track);
  if (!existing) {
    await db.insert(preboardingProgressTable).values({
      userId,
      track,
      stagesJson: stages,
      status,
      completedAt: status === "done" ? now : null,
      updatedAt: now,
    });
    return;
  }
  await db
    .update(preboardingProgressTable)
    .set({
      stagesJson: stages,
      status,
      completedAt: status === "done" ? existing.completedAt || now : existing.completedAt,
      updatedAt: now,
    })
    .where(eq(preboardingProgressTable.id, existing.id));
}

router.get("/preboarding-kurs/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const track = trackOf(req.userRole);
  if (!track) {
    res.status(403).json({ error: "Preboarding farmasevt va mudir uchun" });
    return;
  }
  const rows = await db
    .select()
    .from(preboardingStagesTable)
    .where(and(eq(preboardingStagesTable.track, track), eq(preboardingStagesTable.published, true)))
    .orderBy(asc(preboardingStagesTable.position), asc(preboardingStagesTable.id));
  const progress = await loadProgress(req.userId!, track);
  const map = progress?.stagesJson || {};
  const stages = rows.map((row, index) => {
    const st = map[String(row.id)] || emptyState();
    const prevPassed = rows.slice(0, index).every((p) => map[String(p.id)]?.passed);
    return {
      id: row.id,
      position: index + 1,
      title: row.title,
      subtitle: row.subtitle,
      youtubeId: row.youtubeId || null,
      videoDriveFileId: row.videoDriveFileId,
      driveFileId: row.driveFileId,
      questions: (row.questionsJson || []).map(publicQuestion),
      state: st,
      open: prevPassed,
    };
  });
  const done = stages.length > 0 && stages.every((s) => s.state.passed);
  res.json({
    track,
    passScore: PASS,
    status: done ? "done" : progress?.status || "in_progress",
    stages,
  });
});

router.post("/preboarding-kurs/stages/:id/video", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await markPart(req, res, "video");
});

router.post("/preboarding-kurs/stages/:id/slides", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await markPart(req, res, "slides");
});

async function markPart(req: AuthRequest, res: import("express").Response, part: "video" | "slides") {
  const track = trackOf(req.userRole);
  if (!track || !req.userId) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  const [stage] = await db
    .select()
    .from(preboardingStagesTable)
    .where(and(eq(preboardingStagesTable.id, id), eq(preboardingStagesTable.track, track), eq(preboardingStagesTable.published, true)))
    .limit(1);
  if (!stage) {
    res.status(404).json({ error: "Bosqich topilmadi" });
    return;
  }
  const progress = await loadProgress(req.userId, track);
  const map: PreboardingStagesMap = { ...(progress?.stagesJson || {}) };
  const st = { ...(map[String(id)] || emptyState()) };
  if (part === "video") st.videoDone = true;
  else st.slidesDone = true;
  const questions = stage.questionsJson || [];
  if (questions.length === 0 && st.videoDone && (st.slidesDone || !stage.driveFileId)) {
    st.passed = true;
    st.score = 100;
    st.passedAt = st.passedAt || new Date().toISOString();
  }
  map[String(id)] = st;
  const rows = await db
    .select({ id: preboardingStagesTable.id })
    .from(preboardingStagesTable)
    .where(and(eq(preboardingStagesTable.track, track), eq(preboardingStagesTable.published, true)));
  const done = rows.every((r) => map[String(r.id)]?.passed);
  await saveProgress(req.userId, track, map, done ? "done" : "in_progress");
  res.json({ ok: true, state: st });
}

router.post("/preboarding-kurs/stages/:id/test", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const track = trackOf(req.userRole);
  if (!track || !req.userId) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  const [stage] = await db
    .select()
    .from(preboardingStagesTable)
    .where(and(eq(preboardingStagesTable.id, id), eq(preboardingStagesTable.track, track), eq(preboardingStagesTable.published, true)))
    .limit(1);
  if (!stage) {
    res.status(404).json({ error: "Bosqich topilmadi" });
    return;
  }
  const progress = await loadProgress(req.userId, track);
  const map: PreboardingStagesMap = { ...(progress?.stagesJson || {}) };
  const st = { ...(map[String(id)] || emptyState()) };
  if (!st.videoDone && (stage.youtubeId || stage.videoDriveFileId)) {
    res.status(400).json({ error: "Avval videoni oxirigacha ko‘ring" });
    return;
  }
  const answers = (req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {}) as Record<string, number>;
  const result = score(stage.questionsJson || [], answers);
  st.attempts += 1;
  st.score = result.score;
  st.slidesDone = true;
  if (result.passed) {
    st.passed = true;
    st.passedAt = new Date().toISOString();
  }
  map[String(id)] = st;
  const rows = await db
    .select({ id: preboardingStagesTable.id })
    .from(preboardingStagesTable)
    .where(and(eq(preboardingStagesTable.track, track), eq(preboardingStagesTable.published, true)));
  const done = rows.length > 0 && rows.every((r) => map[String(r.id)]?.passed);
  await saveProgress(req.userId, track, map, done ? "done" : "in_progress");
  res.json({ ok: true, result, state: st });
});

router.get("/preboarding-kurs/admin", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const track = String(req.query.track || "farmasevt");
  if (!TRACKS.has(track)) {
    res.status(400).json({ error: "Yo‘nalish noto‘g‘ri" });
    return;
  }
  const stages = await db
    .select()
    .from(preboardingStagesTable)
    .where(eq(preboardingStagesTable.track, track))
    .orderBy(asc(preboardingStagesTable.position), asc(preboardingStagesTable.id));
  const people = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.role, track));
  const ids = people.map((p) => p.id);
  const progressRows = ids.length
    ? await db
        .select()
        .from(preboardingProgressTable)
        .where(and(eq(preboardingProgressTable.track, track), inArray(preboardingProgressTable.userId, ids)))
    : [];
  const byUser = new Map(progressRows.map((p) => [p.userId, p]));
  res.json({
    track,
    stages,
    results: people.map((p) => {
      const prog = byUser.get(p.id);
      const map = prog?.stagesJson || {};
      return {
        userId: p.id,
        fullName: p.fullName,
        status: prog?.status || "boshlanmagan",
        stages: stages.filter((s) => s.published).map((s) => {
          const st = map[String(s.id)] || emptyState();
          return { id: s.id, title: s.title, score: st.score, attempts: st.attempts, passed: st.passed };
        }),
      };
    }),
  });
});

router.post("/preboarding-kurs/admin/stages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const track = String(req.body?.track || "");
  const title = String(req.body?.title || "").trim().slice(0, 160);
  if (!TRACKS.has(track) || !title) {
    res.status(400).json({ error: "Yo‘nalish va sarlavha kerak" });
    return;
  }
  const youtubeUrl = String(req.body?.youtubeUrl || "").trim().slice(0, 400);
  const pdfUrl = String(req.body?.pdfUrl || "").trim().slice(0, 400);
  const questions = cleanQuestions(req.body?.questions);
  const published = Boolean(req.body?.published);
  const [last] = await db
    .select({ position: preboardingStagesTable.position })
    .from(preboardingStagesTable)
    .where(eq(preboardingStagesTable.track, track))
    .orderBy(desc(preboardingStagesTable.position))
    .limit(1);
  const position = Number(req.body?.position ?? ((last?.position ?? 0) + 1));
  const [row] = await db
    .insert(preboardingStagesTable)
    .values({
      track,
      position: Number.isFinite(position) ? position : 1,
      title,
      subtitle: String(req.body?.subtitle || "").trim().slice(0, 240),
      youtubeUrl,
      youtubeId: parseYoutubeId(youtubeUrl) || "",
      videoDriveFileId: parseYoutubeId(youtubeUrl) ? null : parseDriveFileId(youtubeUrl),
      pdfUrl: pdfUrl || null,
      driveFileId: parseDriveFileId(pdfUrl),
      questionsJson: questions,
      published,
      updatedById: req.userId,
      updatedAt: new Date(),
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/preboarding-kurs/admin/stages/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  const [existing] = await db.select().from(preboardingStagesTable).where(eq(preboardingStagesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Bosqich topilmadi" });
    return;
  }
  const youtubeUrl = req.body?.youtubeUrl != null ? String(req.body.youtubeUrl).trim().slice(0, 400) : existing.youtubeUrl;
  const pdfUrl = req.body?.pdfUrl != null ? String(req.body.pdfUrl).trim().slice(0, 400) : existing.pdfUrl || "";
  const [row] = await db
    .update(preboardingStagesTable)
    .set({
      title: req.body?.title != null ? String(req.body.title).trim().slice(0, 160) : existing.title,
      subtitle: req.body?.subtitle != null ? String(req.body.subtitle).trim().slice(0, 240) : existing.subtitle,
      position: req.body?.position != null ? Number(req.body.position) || existing.position : existing.position,
      youtubeUrl,
      youtubeId: parseYoutubeId(youtubeUrl) || "",
      videoDriveFileId: parseYoutubeId(youtubeUrl) ? null : parseDriveFileId(youtubeUrl),
      pdfUrl: pdfUrl || null,
      driveFileId: parseDriveFileId(pdfUrl),
      questionsJson: req.body?.questions != null ? cleanQuestions(req.body.questions) : existing.questionsJson,
      published: req.body?.published != null ? Boolean(req.body.published) : existing.published,
      updatedById: req.userId,
      updatedAt: new Date(),
    })
    .where(eq(preboardingStagesTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/preboarding-kurs/admin/stages/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManage(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  await db.delete(preboardingStagesTable).where(eq(preboardingStagesTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

export default router;
