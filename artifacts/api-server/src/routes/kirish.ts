import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  kirishProgressTable,
  kirishVideosTable,
  type KirishSlidePdfRow,
  type KirishStagesMap,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canAccessKirish, canManageKirishContent, isStudentRole } from "../lib/roles";
import { KIRISH_PASS_SCORE, type KirishQuestion } from "../lib/kirish-content";
import {
  allStagesPassed,
  ensureDefaultStageVideos,
  ensureStagesMap,
  loadStageDefs,
  nextCustomStageNumber,
  parseAudience,
  publicStage,
  removeCustomStage,
  scoreStage,
  unlockedStage,
  type KirishStageDef,
} from "../lib/kirish-stages";
import { parseYoutubeId } from "../lib/youtube-id";
import { parseDriveFileId } from "../lib/drive-id";

const router: IRouter = Router();

const DONE_STATUSES = new Set(["ready_for_hire", "hired", "completed"]);

function requireLearner(req: AuthRequest, res: import("express").Response): boolean {
  if (!canAccessKirish(req.userRole)) {
    res.status(403).json({ error: "Kirish darslari faqat stajyor va o‘quvchilar uchun" });
    return false;
  }
  return true;
}

function requireContentManager(req: AuthRequest, res: import("express").Response): boolean {
  if (!canManageKirishContent(req.userRole)) {
    res.status(403).json({ error: "Faqat trener, admin, direktor yoki HR direktor" });
    return false;
  }
  return true;
}

type ProgressRow = typeof kirishProgressTable.$inferSelect;

/** Progressni joriy darslar soniga moslab oladi (yangi dars qo‘shilsa ham ochiladi) */
async function getProgress(userId: number, defs: KirishStageDef[], role?: string | null): Promise<ProgressRow> {
  const nums = defs.map((d) => d.stage);
  const [existing] = await db
    .select()
    .from(kirishProgressTable)
    .where(eq(kirishProgressTable.userId, userId))
    .limit(1);
  if (!existing) {
    const [created] = await db
      .insert(kirishProgressTable)
      .values({ userId, currentStage: 1, status: "in_progress", stagesJson: ensureStagesMap({}, nums) })
      .returning();
    return created!;
  }
  const stages = ensureStagesMap(existing.stagesJson as KirishStagesMap, nums);
  const currentStage = unlockedStage(stages, nums, existing.currentStage);
  let status = existing.status;
  if (isStudentRole(role) && status === "completed" && !allStagesPassed(stages, nums)) {
    status = "in_progress";
  }
  if (currentStage === existing.currentStage && status === existing.status) {
    return { ...existing, stagesJson: stages };
  }
  const [updated] = await db
    .update(kirishProgressTable)
    .set({ currentStage, status, stagesJson: stages, updatedAt: new Date() })
    .where(eq(kirishProgressTable.id, existing.id))
    .returning();
  return updated!;
}

function serializeProgress(row: ProgressRow, defs: KirishStageDef[]) {
  const nums = defs.map((d) => d.stage);
  const stages = ensureStagesMap(row.stagesJson as KirishStagesMap, nums);
  return {
    id: row.id,
    userId: row.userId,
    currentStage: unlockedStage(stages, nums, row.currentStage),
    status: row.status,
    stages,
    allPassed: allStagesPassed(stages, nums),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    passScore: KIRISH_PASS_SCORE,
    stageCount: nums.length,
    stageNumbers: nums,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function saveStages(progress: ProgressRow, stages: KirishStagesMap, currentStage = progress.currentStage) {
  const [updated] = await db
    .update(kirishProgressTable)
    .set({ stagesJson: stages, currentStage, updatedAt: new Date() })
    .where(eq(kirishProgressTable.id, progress.id))
    .returning();
  return updated!;
}

function parseAdminQuestions(raw: unknown): KirishQuestion[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "Test savollari noto‘g‘ri" };
  const out: KirishQuestion[] = [];
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

function parseAdminPdfs(raw: unknown): KirishSlidePdfRow[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "Slaydlar ro‘yxati noto‘g‘ri" };
  const out: KirishSlidePdfRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] as Record<string, unknown>;
    const url = String(p?.url ?? "").trim();
    if (!url) continue;
    const driveFileId = parseDriveFileId(url);
    if (!driveFileId) return { error: `${i + 1}-slayd: Google Drive havolasi noto‘g‘ri` };
    out.push({
      id: String(p?.id ?? "").trim() || `pdf-${Date.now()}-${i}`,
      title: String(p?.title ?? "").trim().slice(0, 120),
      url: `https://drive.google.com/file/d/${driveFileId}/view`,
      driveFileId,
    });
  }
  return out;
}

function stageNum(req: AuthRequest): number {
  return Number(req.params.n);
}

function learnerDefs(req: AuthRequest) {
  return loadStageDefs(isStudentRole(req.userRole) ? "students" : "staff");
}

router.get("/kirish/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLearner(req, res)) return;
  await ensureDefaultStageVideos();
  const defs = await learnerDefs(req);
  const progress = await getProgress(req.userId!, defs, req.userRole);
  res.json({
    progress: serializeProgress(progress, defs),
    stages: defs.map(publicStage),
    isStudent: isStudentRole(req.userRole),
  });
});

router.get("/kirish/videos", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireContentManager(req, res)) return;
  await ensureDefaultStageVideos();
  const defs = await loadStageDefs();
  res.json({
    videos: defs.map((d) => ({
      stage: d.stage,
      audience: d.audience,
      title: d.title,
      subtitle: d.subtitle,
      isCustom: d.isCustom,
      youtubeUrl:
        d.row?.youtubeUrl ||
        (d.videoDriveFileId ? `https://drive.google.com/file/d/${d.videoDriveFileId}/view` : ""),
      youtubeId: d.youtubeId,
      videoDriveFileId: d.videoDriveFileId,
      pdfUrl: d.pdfs[0]?.url ?? "",
      driveFileId: d.pdfs[0]?.driveFileId ?? null,
      pdfs: d.pdfs.map((p) => ({ id: p.id, title: p.title, url: p.url, driveFileId: p.driveFileId })),
      textSlides: d.slides.length,
      questions: d.questions,
      updatedAt: d.row?.updatedAt ? d.row.updatedAt.toISOString() : null,
    })),
  });
});

/** Yangi dars (trener) */
router.post("/kirish/stages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireContentManager(req, res)) return;
  const title = String(req.body?.title ?? "").trim().slice(0, 160);
  const subtitle = String(req.body?.subtitle ?? "").trim().slice(0, 300);
  if (!title) {
    res.status(400).json({ error: "Dars nomini yozing" });
    return;
  }
  const stage = await nextCustomStageNumber();
  const [created] = await db
    .insert(kirishVideosTable)
    .values({
      stage,
      title,
      subtitle,
      isCustom: true,
      audience: parseAudience(req.body?.audience),
      youtubeUrl: "",
      youtubeId: "",
      questionsJson: [],
      slidesJson: [],
      updatedById: req.userId ?? null,
    })
    .returning();
  res.status(201).json({ stage: created!.stage });
});

/** Trener qo‘shgan darsni butunlay o‘chirish */
router.delete("/kirish/stages/:n", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireContentManager(req, res)) return;
  const n = stageNum(req);
  const defs = await loadStageDefs();
  const def = defs.find((d) => d.stage === n);
  if (!def) {
    res.status(404).json({ error: "Dars topilmadi" });
    return;
  }
  if (!def.isCustom) {
    res.status(400).json({ error: "Standart bosqichni o‘chirib bo‘lmaydi — faqat tozalash mumkin" });
    return;
  }
  await removeCustomStage(n);
  res.json({ ok: true });
});

router.put("/kirish/videos/:n", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireContentManager(req, res)) return;
  const n = stageNum(req);
  const defs = await loadStageDefs();
  const def = defs.find((d) => d.stage === n);
  if (!def) {
    res.status(400).json({ error: "Noto‘g‘ri bosqich" });
    return;
  }
  const rawYoutube = String(req.body?.youtubeUrl ?? "").trim();
  const videoDriveFileId = rawYoutube ? parseDriveFileId(rawYoutube) : null;
  const youtubeId = rawYoutube && !videoDriveFileId ? parseYoutubeId(rawYoutube) : "";
  if (rawYoutube && !videoDriveFileId && !youtubeId) {
    res.status(400).json({ error: "YouTube yoki Google Drive video havolasi noto‘g‘ri" });
    return;
  }

  let pdfs: KirishSlidePdfRow[];
  if (Array.isArray(req.body?.pdfs)) {
    const parsed = parseAdminPdfs(req.body.pdfs);
    if (!Array.isArray(parsed)) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    pdfs = parsed;
  } else {
    const parsed = parseAdminPdfs([{ url: req.body?.pdfUrl ?? "" }]);
    if (!Array.isArray(parsed)) {
      res.status(400).json({ error: "Google Drive PDF havolasi noto‘g‘ri" });
      return;
    }
    pdfs = parsed;
  }

  const parsedQs = parseAdminQuestions(req.body?.questions);
  if (!Array.isArray(parsedQs)) {
    res.status(400).json({ error: parsedQs.error });
    return;
  }
  const title = req.body?.title != null ? String(req.body.title).trim().slice(0, 160) : undefined;
  const subtitle = req.body?.subtitle != null ? String(req.body.subtitle).trim().slice(0, 300) : undefined;
  if (def.isCustom && title === "") {
    res.status(400).json({ error: "Dars nomini yozing" });
    return;
  }
  if (
    !def.isCustom &&
    !youtubeId &&
    !videoDriveFileId &&
    pdfs.length === 0 &&
    parsedQs.length === 0 &&
    !title &&
    req.body?.audience == null
  ) {
    res.status(400).json({ error: "YouTube/Drive video, PDF yoki test savolini yozing" });
    return;
  }

  const youtubeUrl = youtubeId
    ? `https://www.youtube.com/watch?v=${youtubeId}`
    : videoDriveFileId
      ? `https://drive.google.com/file/d/${videoDriveFileId}/view`
      : "";
  const main = pdfs[0];
  const values = {
    youtubeUrl,
    youtubeId: youtubeId || "",
    videoDriveFileId,
    pdfUrl: main?.url ?? null,
    driveFileId: main?.driveFileId ?? null,
    slidesJson: pdfs,
    questionsJson: parsedQs,
    ...(title !== undefined ? { title: title || null } : {}),
    ...(subtitle !== undefined ? { subtitle: subtitle || null } : {}),
    ...(req.body?.audience != null ? { audience: parseAudience(req.body.audience) } : {}),
    updatedById: req.userId ?? null,
    updatedAt: new Date(),
  };
  if (def.row) {
    const [updated] = await db
      .update(kirishVideosTable)
      .set(values)
      .where(eq(kirishVideosTable.id, def.row.id))
      .returning();
    res.json({ video: updated });
    return;
  }
  const [created] = await db
    .insert(kirishVideosTable)
    .values({ stage: n, isCustom: false, ...values })
    .returning();
  res.json({ video: created });
});

/** Materiallarni tozalash: standart bosqich — standartga qaytadi, trener darsi — bo‘sh qoladi */
router.delete("/kirish/videos/:n", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireContentManager(req, res)) return;
  const n = stageNum(req);
  const defs = await loadStageDefs();
  const def = defs.find((d) => d.stage === n);
  if (!def) {
    res.status(400).json({ error: "Noto‘g‘ri bosqich" });
    return;
  }
  if (def.isCustom && def.row) {
    await db
      .update(kirishVideosTable)
      .set({
        youtubeUrl: "",
        youtubeId: "",
        videoDriveFileId: null,
        pdfUrl: null,
        driveFileId: null,
        slidesJson: [],
        questionsJson: [],
        updatedById: req.userId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(kirishVideosTable.id, def.row.id));
  } else {
    await db.delete(kirishVideosTable).where(eq(kirishVideosTable.stage, n));
  }
  res.json({ ok: true });
});

async function learnerContext(req: AuthRequest, res: import("express").Response) {
  if (!requireLearner(req, res)) return null;
  const n = stageNum(req);
  const defs = await learnerDefs(req);
  const def = defs.find((d) => d.stage === n);
  if (!def) {
    res.status(400).json({ error: "Noto‘g‘ri bosqich" });
    return null;
  }
  const progress = await getProgress(req.userId!, defs, req.userRole);
  const current = serializeProgress(progress, defs).currentStage;
  return { n, def, defs, progress, current };
}

router.post(
  "/kirish/me/stage/:n/complete-video",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const ctx = await learnerContext(req, res);
    if (!ctx) return;
    const { n, defs, progress, current } = ctx;
    if (DONE_STATUSES.has(progress.status)) {
      res.json({ progress: serializeProgress(progress, defs) });
      return;
    }
    if (n > current) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const stages = ensureStagesMap(progress.stagesJson as KirishStagesMap, defs.map((d) => d.stage));
    stages[String(n)] = { ...stages[String(n)]!, videoDone: true };
    const updated = await saveStages(progress, stages);
    res.json({ progress: serializeProgress(updated, defs) });
  },
);

router.post(
  "/kirish/me/stage/:n/complete-slides",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const ctx = await learnerContext(req, res);
    if (!ctx) return;
    const { n, defs, progress, current } = ctx;
    if (DONE_STATUSES.has(progress.status)) {
      res.json({ progress: serializeProgress(progress, defs) });
      return;
    }
    if (n > current) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const stages = ensureStagesMap(progress.stagesJson as KirishStagesMap, defs.map((d) => d.stage));
    const st = stages[String(n)]!;
    if (!st.videoDone) {
      res.status(400).json({ error: "Avval videoni ko‘ring" });
      return;
    }
    stages[String(n)] = { ...st, slidesDone: true };
    const updated = await saveStages(progress, stages);
    res.json({ progress: serializeProgress(updated, defs) });
  },
);

router.post(
  "/kirish/me/stage/:n/submit-test",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const ctx = await learnerContext(req, res);
    if (!ctx) return;
    const { n, def, defs, progress, current } = ctx;
    if (DONE_STATUSES.has(progress.status)) {
      res.status(400).json({ error: "Kurs allaqachon yakunlangan" });
      return;
    }
    if (n > current) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const nums = defs.map((d) => d.stage);
    const stages = ensureStagesMap(progress.stagesJson as KirishStagesMap, nums);
    const st = stages[String(n)]!;
    if (!st.videoDone || !st.slidesDone) {
      res.status(400).json({ error: "Avval video va slaydlarni tugating" });
      return;
    }
    const answers = (req.body?.answers || {}) as Record<string, number>;
    const result = scoreStage(def.questions, answers);
    stages[String(n)] = {
      ...st,
      videoDone: result.passed ? st.videoDone : false,
      score: result.score,
      attempts: st.attempts + 1,
      passed: result.passed,
      passedAt: result.passed ? new Date().toISOString() : st.passedAt,
    };
    const updated = await saveStages(progress, stages, unlockedStage(stages, nums, progress.currentStage));
    res.json({ result, progress: serializeProgress(updated, defs) });
  },
);

router.post("/kirish/me/finish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLearner(req, res)) return;
  const defs = await learnerDefs(req);
  const nums = defs.map((d) => d.stage);
  const progress = await getProgress(req.userId!, defs, req.userRole);
  const stages = ensureStagesMap(progress.stagesJson as KirishStagesMap, nums);
  if (!allStagesPassed(stages, nums)) {
    res.status(400).json({ error: "Barcha bosqichlarni muvaffaqiyatli yakunlang" });
    return;
  }

  const student = isStudentRole(req.userRole);
  const status = student ? "completed" : "ready_for_hire";
  const now = new Date();
  const [updated] = await db
    .update(kirishProgressTable)
    .set({ status, completedAt: now, updatedAt: now, stagesJson: stages })
    .where(eq(kirishProgressTable.id, progress.id))
    .returning();

  const scores = nums.map((n) => {
    const s = stages[String(n)]!;
    return { stage: n, score: s.score, attempts: s.attempts, passedAt: s.passedAt };
  });
  const avg = scores.reduce((a, b) => a + (b.score ?? 0), 0) / Math.max(1, scores.length);

  res.json({
    progress: serializeProgress(updated!, defs),
    report: {
      status,
      statusLabel: student ? "Kurs yakunlandi" : "Ishga qabulga tayyor",
      averageScore: Math.round(avg),
      stages: scores,
      completedAt: now.toISOString(),
      message: student
        ? "Tabriklaymiz! Barcha darslarni muvaffaqiyatli yakunladingiz. Natijalaringiz treneringizga ko‘rinadi."
        : "Stajor barcha Kirish bosqichlarini muvaffaqiyatli yakunladi. HR/admin ishga olishni tasdiqlashi mumkin.",
    },
  });
});

export default router;
