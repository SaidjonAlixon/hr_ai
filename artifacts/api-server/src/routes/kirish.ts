import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  kirishProgressTable,
  type KirishStageState,
  type KirishStagesMap,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canAccessKirish } from "../lib/roles";
import {
  KIRISH_STAGE_COUNT,
  getStage,
  publicStagePayload,
  scoreAnswers,
  KIRISH_STAGES,
  KIRISH_PASS_SCORE,
} from "../lib/kirish-content";

const router: IRouter = Router();

function emptyStage(): KirishStageState {
  return {
    videoDone: false,
    slidesDone: false,
    score: null,
    attempts: 0,
    passed: false,
    passedAt: null,
  };
}

function ensureStagesMap(raw: KirishStagesMap | null | undefined): KirishStagesMap {
  const map: KirishStagesMap = { ...(raw || {}) };
  for (let i = 1; i <= KIRISH_STAGE_COUNT; i++) {
    const key = String(i);
    if (!map[key]) map[key] = emptyStage();
  }
  return map;
}

function requireStajyor(req: AuthRequest, res: import("express").Response): boolean {
  if (!canAccessKirish(req.userRole)) {
    res.status(403).json({ error: "Faqat stajyor uchun" });
    return false;
  }
  return true;
}

async function getOrCreateProgress(userId: number) {
  const [existing] = await db
    .select()
    .from(kirishProgressTable)
    .where(eq(kirishProgressTable.userId, userId))
    .limit(1);
  if (existing) {
    return {
      ...existing,
      stagesJson: ensureStagesMap(existing.stagesJson as KirishStagesMap),
    };
  }
  const stages = ensureStagesMap({});
  const [created] = await db
    .insert(kirishProgressTable)
    .values({
      userId,
      currentStage: 1,
      status: "in_progress",
      stagesJson: stages,
    })
    .returning();
  return { ...created, stagesJson: stages };
}

function serializeProgress(row: Awaited<ReturnType<typeof getOrCreateProgress>>) {
  const stages = ensureStagesMap(row.stagesJson);
  const allPassed = Array.from({ length: KIRISH_STAGE_COUNT }, (_, i) =>
    Boolean(stages[String(i + 1)]?.passed),
  ).every(Boolean);

  return {
    id: row.id,
    userId: row.userId,
    currentStage: row.currentStage,
    status: row.status,
    stages,
    allPassed,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    passScore: KIRISH_PASS_SCORE,
    stageCount: KIRISH_STAGE_COUNT,
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/kirish/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStajyor(req, res)) return;
  const progress = await getOrCreateProgress(req.userId!);
  res.json({
    progress: serializeProgress(progress),
    stages: KIRISH_STAGES.map(publicStagePayload),
  });
});

router.post(
  "/kirish/me/stage/:n/complete-video",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireStajyor(req, res)) return;
    const n = Number(req.params.n);
    if (!getStage(n)) {
      res.status(400).json({ error: "Noto‘g‘ri bosqich" });
      return;
    }
    const progress = await getOrCreateProgress(req.userId!);
    if (progress.status === "ready_for_hire" || progress.status === "hired") {
      res.json({ progress: serializeProgress(progress) });
      return;
    }
    if (n > progress.currentStage) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const stages = ensureStagesMap(progress.stagesJson);
    const key = String(n);
    stages[key] = { ...stages[key]!, videoDone: true };
    const [updated] = await db
      .update(kirishProgressTable)
      .set({ stagesJson: stages, updatedAt: new Date() })
      .where(eq(kirishProgressTable.id, progress.id))
      .returning();
    res.json({
      progress: serializeProgress({
        ...updated,
        stagesJson: ensureStagesMap(updated.stagesJson as KirishStagesMap),
      }),
    });
  },
);

router.post(
  "/kirish/me/stage/:n/complete-slides",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireStajyor(req, res)) return;
    const n = Number(req.params.n);
    if (!getStage(n)) {
      res.status(400).json({ error: "Noto‘g‘ri bosqich" });
      return;
    }
    const progress = await getOrCreateProgress(req.userId!);
    if (progress.status === "ready_for_hire" || progress.status === "hired") {
      res.json({ progress: serializeProgress(progress) });
      return;
    }
    if (n > progress.currentStage) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const stages = ensureStagesMap(progress.stagesJson);
    const key = String(n);
    const st = stages[key]!;
    if (!st.videoDone) {
      res.status(400).json({ error: "Avval videoni ko‘ring" });
      return;
    }
    stages[key] = { ...st, slidesDone: true };
    const [updated] = await db
      .update(kirishProgressTable)
      .set({ stagesJson: stages, updatedAt: new Date() })
      .where(eq(kirishProgressTable.id, progress.id))
      .returning();
    res.json({
      progress: serializeProgress({
        ...updated,
        stagesJson: ensureStagesMap(updated.stagesJson as KirishStagesMap),
      }),
    });
  },
);

router.post(
  "/kirish/me/stage/:n/submit-test",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireStajyor(req, res)) return;
    const n = Number(req.params.n);
    const stage = getStage(n);
    if (!stage) {
      res.status(400).json({ error: "Noto‘g‘ri bosqich" });
      return;
    }
    const progress = await getOrCreateProgress(req.userId!);
    if (progress.status === "ready_for_hire" || progress.status === "hired") {
      res.status(400).json({ error: "Kurs allaqachon yakunlangan" });
      return;
    }
    if (n > progress.currentStage) {
      res.status(400).json({ error: "Avval oldingi bosqichni yakunlang" });
      return;
    }
    const stages = ensureStagesMap(progress.stagesJson);
    const key = String(n);
    const st = stages[key]!;
    if (!st.videoDone || !st.slidesDone) {
      res.status(400).json({ error: "Avval video va slaydlarni tugating" });
      return;
    }

    const answers = (req.body?.answers || {}) as Record<string, number>;
    const result = scoreAnswers(stage, answers);
    const nowIso = new Date().toISOString();
    stages[key] = {
      ...st,
      score: result.score,
      attempts: st.attempts + 1,
      passed: result.passed,
      passedAt: result.passed ? nowIso : st.passedAt,
    };

    let currentStage = progress.currentStage;
    if (result.passed && n === progress.currentStage && n < KIRISH_STAGE_COUNT) {
      currentStage = n + 1;
    }

    const [updated] = await db
      .update(kirishProgressTable)
      .set({
        stagesJson: stages,
        currentStage,
        updatedAt: new Date(),
      })
      .where(eq(kirishProgressTable.id, progress.id))
      .returning();

    res.json({
      result,
      progress: serializeProgress({
        ...updated,
        stagesJson: ensureStagesMap(updated.stagesJson as KirishStagesMap),
      }),
    });
  },
);

router.post("/kirish/me/finish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireStajyor(req, res)) return;
  const progress = await getOrCreateProgress(req.userId!);
  const stages = ensureStagesMap(progress.stagesJson);
  const allPassed = Array.from({ length: KIRISH_STAGE_COUNT }, (_, i) =>
    Boolean(stages[String(i + 1)]?.passed),
  ).every(Boolean);

  if (!allPassed) {
    res.status(400).json({ error: "Barcha bosqichlarni muvaffaqiyatli yakunlang" });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(kirishProgressTable)
    .set({
      status: "ready_for_hire",
      completedAt: now,
      updatedAt: now,
      stagesJson: stages,
    })
    .where(eq(kirishProgressTable.id, progress.id))
    .returning();

  const scores = Array.from({ length: KIRISH_STAGE_COUNT }, (_, i) => {
    const s = stages[String(i + 1)]!;
    return { stage: i + 1, score: s.score, attempts: s.attempts, passedAt: s.passedAt };
  });
  const avg =
    scores.reduce((a, b) => a + (b.score ?? 0), 0) / Math.max(1, scores.length);

  res.json({
    progress: serializeProgress({
      ...updated,
      stagesJson: ensureStagesMap(updated.stagesJson as KirishStagesMap),
    }),
    report: {
      status: "ready_for_hire",
      statusLabel: "Ishga qabulga tayyor",
      averageScore: Math.round(avg),
      stages: scores,
      completedAt: now.toISOString(),
      message:
        "Stajor barcha Kirish bosqichlarini muvaffaqiyatli yakunladi. HR/admin ishga olishni tasdiqlashi mumkin.",
    },
  });
});

export default router;
