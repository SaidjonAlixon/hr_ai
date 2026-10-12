import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  kirishVideosTable,
  type KirishSlidePdfRow,
  type KirishStageState,
  type KirishStagesMap,
} from "@workspace/db";
import {
  KIRISH_PASS_SCORE,
  KIRISH_STAGES,
  type KirishQuestion,
  type KirishSlide,
} from "./kirish-content";
import { drivePreviewUrl } from "./drive-id";

/** Bosqich videolari (DB bo‘sh bo‘lsa ham ko‘rinadi) */
export const DEFAULT_STAGE_VIDEO_DRIVE: Record<number, string> = {
  5: "1swNC0epB65S9H0tpHeiQHynmB-W9pi2c",
};

export type KirishVideoRow = typeof kirishVideosTable.$inferSelect;

export type KirishPdf = { id: string; title: string; driveFileId: string; url: string };

export type KirishStageDef = {
  stage: number;
  title: string;
  subtitle: string;
  videoUrl: string;
  videoPosterHint: string;
  slides: KirishSlide[];
  questions: KirishQuestion[];
  isCustom: boolean;
  youtubeId: string | null;
  videoDriveFileId: string | null;
  pdfs: KirishPdf[];
  row: KirishVideoRow | null;
};

export async function ensureDefaultStageVideos() {
  for (const [stageStr, fileId] of Object.entries(DEFAULT_STAGE_VIDEO_DRIVE)) {
    const stage = Number(stageStr);
    const [existing] = await db
      .select()
      .from(kirishVideosTable)
      .where(eq(kirishVideosTable.stage, stage))
      .limit(1);
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    if (!existing) {
      await db.insert(kirishVideosTable).values({
        stage,
        youtubeUrl: driveUrl,
        youtubeId: "",
        videoDriveFileId: fileId,
        questionsJson: [],
      });
      continue;
    }
    if (existing.youtubeId) continue;
    if (existing.videoDriveFileId === fileId) continue;
    await db
      .update(kirishVideosTable)
      .set({
        videoDriveFileId: fileId,
        youtubeUrl: existing.youtubeUrl || driveUrl,
        updatedAt: new Date(),
      })
      .where(eq(kirishVideosTable.id, existing.id));
  }
}

function overlayQuestions(base: KirishQuestion[], custom?: KirishQuestion[] | null): KirishQuestion[] {
  if (!Array.isArray(custom) || custom.length === 0) return base;
  return custom.map((q, i) => {
    const expected = Number(q?.correctIndex);
    return {
      id: String(q?.id || base[i]?.id || `q-${i + 1}`),
      text: String(q?.text || ""),
      options: Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "")) : [],
      correctIndex: Number.isInteger(expected) ? expected : Number(base[i]?.correctIndex ?? 0),
    };
  });
}

/** slides_json — barcha PDF slaydlar; bo‘sh bo‘lsa eski yagona pdf_url ishlatiladi */
export function stagePdfs(row: KirishVideoRow | null | undefined): KirishPdf[] {
  if (!row) return [];
  const list = Array.isArray(row.slidesJson) ? (row.slidesJson as KirishSlidePdfRow[]) : [];
  const out: KirishPdf[] = [];
  for (const p of list) {
    if (!p?.driveFileId) continue;
    out.push({
      id: String(p.id || p.driveFileId),
      title: String(p.title || "").trim() || (out.length === 0 ? "Slayd" : `Slayd ${out.length + 1}`),
      driveFileId: p.driveFileId,
      url: p.url || `https://drive.google.com/file/d/${p.driveFileId}/view`,
    });
  }
  if (out.length === 0 && row.driveFileId) {
    out.push({
      id: "main",
      title: "Slayd",
      driveFileId: row.driveFileId,
      url: row.pdfUrl || `https://drive.google.com/file/d/${row.driveFileId}/view`,
    });
  }
  return out;
}

/** Standart 8 bosqich + trener qo‘shgan darslar, tartib bo‘yicha */
export async function loadStageDefs(): Promise<KirishStageDef[]> {
  const rows = await db.select().from(kirishVideosTable);
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  const builtinNums = new Set(KIRISH_STAGES.map((s) => s.stage));

  const defs: KirishStageDef[] = KIRISH_STAGES.map((s) => {
    const row = byStage.get(s.stage) ?? null;
    const youtubeId = (row?.youtubeId || "").trim() || null;
    const videoDriveFileId =
      row?.videoDriveFileId || (!youtubeId && !row ? DEFAULT_STAGE_VIDEO_DRIVE[s.stage] ?? null : null) || null;
    return {
      stage: s.stage,
      title: row?.title?.trim() || s.title,
      subtitle: row?.subtitle?.trim() || s.subtitle,
      videoUrl: s.videoUrl,
      videoPosterHint: s.videoPosterHint,
      slides: s.slides,
      questions: overlayQuestions(s.questions, row?.questionsJson as KirishQuestion[] | null),
      isCustom: false,
      youtubeId,
      videoDriveFileId,
      pdfs: stagePdfs(row),
      row,
    };
  });

  for (const row of rows) {
    if (builtinNums.has(row.stage)) continue;
    const youtubeId = (row.youtubeId || "").trim() || null;
    defs.push({
      stage: row.stage,
      title: row.title?.trim() || `${row.stage}-dars`,
      subtitle: row.subtitle?.trim() || "",
      videoUrl: "",
      videoPosterHint: row.title?.trim() || `${row.stage}-dars`,
      slides: [],
      questions: overlayQuestions([], row.questionsJson as KirishQuestion[] | null),
      isCustom: true,
      youtubeId,
      videoDriveFileId: row.videoDriveFileId || null,
      pdfs: stagePdfs(row),
      row,
    });
  }

  return defs.sort((a, b) => a.stage - b.stage);
}

export function publicStage(def: KirishStageDef) {
  const videoKind = def.youtubeId ? ("youtube" as const) : def.videoDriveFileId ? ("drive" as const) : ("file" as const);
  return {
    stage: def.stage,
    title: def.title,
    subtitle: def.subtitle,
    videoUrl: def.youtubeId
      ? def.row?.youtubeUrl || `https://www.youtube.com/watch?v=${def.youtubeId}`
      : def.videoDriveFileId
        ? drivePreviewUrl(def.videoDriveFileId)
        : def.videoUrl,
    videoPosterHint: def.videoPosterHint,
    videoKind,
    youtubeId: def.youtubeId,
    videoDriveFileId: def.videoDriveFileId,
    hasVideo: Boolean(def.youtubeId || def.videoDriveFileId),
    pdfUrl: def.pdfs[0]?.url ?? null,
    driveFileId: def.pdfs[0]?.driveFileId ?? null,
    pdfs: def.pdfs.map((p) => ({ id: p.id, title: p.title, driveFileId: p.driveFileId })),
    slides: def.slides,
    isCustom: def.isCustom,
    questions: def.questions.map((q) => ({ id: q.id, text: q.text, options: q.options })),
  };
}

export function emptyStageState(): KirishStageState {
  return { videoDone: false, slidesDone: false, score: null, attempts: 0, passed: false, passedAt: null };
}

export function ensureStagesMap(raw: KirishStagesMap | null | undefined, stageNums: number[]): KirishStagesMap {
  const map: KirishStagesMap = { ...(raw || {}) };
  for (const n of stageNums) {
    const key = String(n);
    if (!map[key]) map[key] = emptyStageState();
  }
  return map;
}

/** Ochiq bo‘lgan eng katta bosqich: ketma-ket o‘tilganlardan keyingisi */
export function unlockedStage(stages: KirishStagesMap, stageNums: number[], stored: number): number {
  if (stageNums.length === 0) return 1;
  let firstOpen = stageNums[stageNums.length - 1]!;
  for (const n of stageNums) {
    if (!stages[String(n)]?.passed) {
      firstOpen = n;
      break;
    }
  }
  const max = stageNums[stageNums.length - 1]!;
  return Math.max(1, Math.min(max, Math.max(stored, firstOpen)));
}

export function allStagesPassed(stages: KirishStagesMap, stageNums: number[]): boolean {
  return stageNums.length > 0 && stageNums.every((n) => Boolean(stages[String(n)]?.passed));
}

export function scoreStage(
  questions: KirishQuestion[],
  answers: Record<string, number>,
): { score: number; correct: number; total: number; passed: boolean } {
  const total = questions.length;
  if (total === 0) return { score: 100, correct: 0, total: 0, passed: true };
  let correct = 0;
  for (const q of questions) {
    const given = Number(answers[q.id]);
    if (Number.isInteger(given) && given === Number(q.correctIndex)) correct += 1;
  }
  const score = Math.round((correct / total) * 100);
  return { score, correct, total, passed: score >= KIRISH_PASS_SCORE };
}

/** Bitta foydalanuvchi progressi bo‘yicha qisqa statistika */
export function progressSummary(
  row: { currentStage: number; status: string; stagesJson: unknown; completedAt: Date | null; updatedAt: Date } | null,
  defs: KirishStageDef[],
) {
  const nums = defs.map((d) => d.stage);
  const stages = ensureStagesMap((row?.stagesJson as KirishStagesMap) ?? null, nums);
  const details = defs.map((d) => {
    const st = stages[String(d.stage)] ?? emptyStageState();
    return {
      stage: d.stage,
      title: d.title,
      score: st.score,
      attempts: st.attempts,
      passed: Boolean(st.passed),
      videoDone: Boolean(st.videoDone),
      slidesDone: Boolean(st.slidesDone),
      passedAt: st.passedAt,
    };
  });
  const passed = details.filter((d) => d.passed).length;
  const scores = details.map((d) => d.score).filter((s): s is number => s != null);
  const attempts = details.reduce((a, d) => a + d.attempts, 0);
  return {
    status: row?.status ?? "not_started",
    currentStage: row ? unlockedStage(stages, nums, row.currentStage) : 1,
    stageCount: nums.length,
    passed,
    attempts,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    progressPct: nums.length ? Math.round((passed / nums.length) * 100) : 0,
    completedAt: row?.completedAt ? row.completedAt.toISOString() : null,
    lastActivityAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    stages: details,
  };
}

/** Trener qo‘shgan darsni o‘chirish va keyingi darslar raqamini bittaga surish (progress ham) */
export async function removeCustomStage(n: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM kirish_videos WHERE stage = $1", [n]);
    await client.query("UPDATE kirish_videos SET stage = -(stage - 1) WHERE stage > $1", [n]);
    await client.query("UPDATE kirish_videos SET stage = -stage WHERE stage < 0");
    const { rows } = await client.query<{ id: number; current_stage: number; stages_json: KirishStagesMap | null }>(
      "SELECT id, current_stage, stages_json FROM kirish_progress",
    );
    for (const r of rows) {
      const src = r.stages_json || {};
      const next: KirishStagesMap = {};
      for (const [k, v] of Object.entries(src)) {
        const num = Number(k);
        if (!Number.isInteger(num) || num === n) continue;
        next[String(num > n ? num - 1 : num)] = v;
      }
      const cur = r.current_stage > n ? r.current_stage - 1 : r.current_stage;
      await client.query(
        "UPDATE kirish_progress SET stages_json = $2::jsonb, current_stage = $3, updated_at = NOW() WHERE id = $1",
        [r.id, JSON.stringify(next), Math.max(1, cur)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function nextCustomStageNumber(): Promise<number> {
  const [r] = await db
    .select({ max: sql<number>`COALESCE(MAX(${kirishVideosTable.stage}), 0)` })
    .from(kirishVideosTable);
  const builtinMax = Math.max(...KIRISH_STAGES.map((s) => s.stage));
  return Math.max(builtinMax, Number(r?.max ?? 0)) + 1;
}
