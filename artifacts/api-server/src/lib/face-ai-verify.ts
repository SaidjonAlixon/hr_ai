/**
 * OpenAI Vision — Face ID enroll + login tasdiq.
 * Lokal 128-d embedding birinchi filtr. AI faqat shubhada / tasdiqda.
 * Xarajat: detail=low, kichik gallery, pairwise default o‘chirilgan.
 * Kalit faqat process.env (backend .env).
 */
import { logger } from "./logger";
import {
  decideFaceAiGate,
  loginFailFromScores,
  parseFaceAiIdentify,
  parseFaceAiInspect,
  parseFaceAiPayload,
  pickAiIdentityWinner,
  FACE_LOGIN_MSG_NOT_ENROLLED,
  type FaceAiCandidateScore,
  type FaceAiCompareResult,
  type FaceAiGate,
} from "./face-ai-decision";
import { FACE_MATCH_MAX, isSamePerson } from "./face-identity";

export {
  decideFaceAiGate,
  parseFaceAiIdentify,
  parseFaceAiPayload,
  pickAiIdentityWinner,
  type FaceAiCompareResult,
  type FaceAiGate,
};

export const FACE_AI_TIMEOUT_MS = envNum("FACE_AI_TIMEOUT_MS", 20_000);

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim()?.toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "off", "no"].includes(raw)) return false;
  if (["1", "true", "on", "yes"].includes(raw)) return true;
  return fallback;
}

/** low ≈ 85 token/rasm; high — yuzlab–minglab (asosan shu pullarni yeydi). */
export const FACE_AI_IMAGE_DETAIL = (process.env.FACE_AI_IMAGE_DETAIL?.trim() || "low") as
  | "low"
  | "high"
  | "auto";
/** Shubhali login: faqat top-2. */
export const FACE_AI_GALLERY_MAX = Math.max(1, Math.min(4, envNum("FACE_AI_GALLERY_MAX", 2)));
/** 0 = pairwise o‘chirilgan. Shubhada default 2 (top-2 taqqoslash). */
export const FACE_AI_PAIRWISE_MAX = Math.max(0, Math.min(5, envNum("FACE_AI_PAIRWISE_MAX", 2)));
/** Enroll duplicate AI — baza rasmi bilan solishtirish, default 2. */
export const FACE_AI_DUP_MAX = Math.max(0, Math.min(3, envNum("FACE_AI_DUP_MAX", 2)));
/** Enroll sifat AI — default yoqilgan (baza rasmi sifatli bo‘lsin). */
export const FACE_AI_ENROLL_INSPECT = envFlag("FACE_AI_ENROLL_INSPECT", true);
/** Gallery match dan keyin qo‘shimcha confirm — default o‘chirilgan. */
export const FACE_AI_CONFIRM = envFlag("FACE_AI_CONFIRM", false);
/** Aniq lokal match bo‘lsa AI chaqirilmasin. */
export const FACE_AI_SKIP_IF_CLEAR = envFlag("FACE_AI_SKIP_IF_CLEAR", true);
/** Eng yaqin va 2-o‘rin orasidagi minimal farq (dist). */
export const FACE_AI_CLEAR_MARGIN = envNum("FACE_AI_CLEAR_MARGIN", 0.06);
/** Data URL uzunligi shundan katta bo‘lsa AI o‘tkazilmaydi (lokal). */
export const FACE_AI_MAX_IMAGE_CHARS = envNum("FACE_AI_MAX_IMAGE_CHARS", 180_000);
/**
 * Lokal embedding shu dist gacha bo‘lsa ham baza rasmi bilan AI solishtiriladi.
 * (Thresholddan pastroq bo‘lsa ham rasm bor — «tizimdan o‘tmagan» deb yopilmasin.)
 */
export const FACE_AI_SOFT_DIST = envNum("FACE_AI_SOFT_DIST", 0.55);

export function isFaceAiEnabled(): boolean {
  if (!envFlag("FACE_AI_VERIFY", true)) return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function imageDetail(): "low" | "high" | "auto" {
  const d = FACE_AI_IMAGE_DETAIL;
  if (d === "high" || d === "auto") return d;
  return "low";
}

function imgPart(url: string) {
  return { type: "image_url" as const, image_url: { url, detail: imageDetail() } };
}

function toDataUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("data:image/")) return null;
  if (s.length < 80 || s.length > 1_200_000) return null;
  return s;
}

/** Live kadr AI uchun: juda katta bo‘lsa null (lokal yo‘l). */
function toAiLiveDataUrl(raw: string | null | undefined): string | null {
  const s = toDataUrl(raw);
  if (!s) return null;
  if (s.length > FACE_AI_MAX_IMAGE_CHARS) {
    logger.info(
      { event: "face_ai_image_too_large", chars: s.length, max: FACE_AI_MAX_IMAGE_CHARS },
      "face AI skip oversized live image",
    );
    return null;
  }
  return s;
}

async function openaiJson(
  messages: unknown[],
  maxTokens = 220,
): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const model = process.env.OPENAI_FACE_MODEL?.trim() || "gpt-4.1-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FACE_AI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`openai_http_${res.status}:${errText.slice(0, 180)}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("openai_bad_json");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiFaceCompare(
  enrolledDataUrl: string,
  liveDataUrl: string,
): Promise<FaceAiCompareResult> {
  const parsed = parseFaceAiPayload(
    await openaiJson([
      {
        role: "system",
        content:
          "You are a strict biometric matcher. Compare two full face photos of real people. " +
          "Ignore hijab, glasses frames, clothing, background, lighting, makeup, hair. " +
          "Match identity from eyes, eyelids, nose, philtrum, mouth, jaw, moles, ear shape. " +
          "samePerson=true only if it is the same human. A lookalike must be false. Never guess yes. " +
          'JSON: {"samePerson":boolean,"confidence":0-1,"similarity":0-1}.',
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1 = enrolled employee record. Image 2 = live camera. Same human?" },
          imgPart(enrolledDataUrl),
          imgPart(liveDataUrl),
        ],
      },
    ]),
  );
  if (!parsed) throw new Error("openai_bad_json");
  return parsed;
}

async function callOpenAiEnrollDuplicate(
  enrolledDataUrl: string,
  liveDataUrl: string,
): Promise<FaceAiCompareResult> {
  const parsed = parseFaceAiPayload(
    await openaiJson([
      {
        role: "system",
        content:
          "You check if a NEW Face ID enrollment is the same human as an already enrolled photo. " +
          "Hijab, niqab, glasses, clothing, background, lighting, and hair MUST be ignored. " +
          "Two different people who both wear hijab are NOT the same person. " +
          "samePerson=true only if eyes, eyelids, nose, moles and jaw prove it is the identical human. " +
          "If unsure, samePerson=false. Never guess yes. " +
          'JSON: {"samePerson":boolean,"confidence":0-1,"similarity":0-1}.',
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1 = already enrolled. Image 2 = new enrollment. Identical human, or a different person?" },
          imgPart(enrolledDataUrl),
          imgPart(liveDataUrl),
        ],
      },
    ]),
  );
  if (!parsed) throw new Error("openai_bad_json");
  return parsed;
}

function isCertainEnrollDuplicate(ai: FaceAiCompareResult): boolean {
  return ai.samePerson && ai.confidence >= 0.95 && ai.similarity >= 0.95;
}

async function callOpenAiFaceIdentify(
  liveDataUrl: string,
  gallery: Array<{ id: number; dataUrl: string }>,
): Promise<number | null> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "LIVE is the unlabeled camera photo. ENROLLED photos are labeled with numeric id. " +
        "Return matchId of the enrolled photo that is the SAME human as LIVE, or null. " +
        "Do not pick the closest lookalike. If two enrolled faces could match, return null. " +
        `Allowed ids: ${gallery.map((g) => g.id).join(", ")}. ` +
        'JSON: {"matchId":number|null}.',
    },
    { type: "text", text: "LIVE:" },
    imgPart(liveDataUrl),
  ];
  for (const g of gallery) {
    content.push({ type: "text", text: `ENROLLED id=${g.id}:` });
    content.push(imgPart(g.dataUrl));
  }
  const raw = await openaiJson(
    [
      {
        role: "system",
        content:
          "You identify one person from a gallery of enrolled workplace photos. " +
          "Ignore hijab, glasses, clothing, background. Use eyes, nose, jaw, moles. " +
          "Return null unless you are certain. Never pick a lookalike. " +
          "matchId must be one of the labeled ids or null.",
      },
      { role: "user", content },
    ],
    80,
  );
  return parseFaceAiIdentify(
    raw,
    gallery.map((g) => g.id),
  );
}

/** Lokal embedding aniq egasi — AI kerak emas. */
export function isClearLocalIdentity(
  candidates: Array<{ dist: number; cosine: number }>,
): boolean {
  if (!FACE_AI_SKIP_IF_CLEAR) return false;
  const best = candidates[0];
  const second = candidates[1];
  if (!best || !isSamePerson(best.dist, best.cosine, FACE_MATCH_MAX)) return false;
  if (!second) return true;
  return second.dist - best.dist >= FACE_AI_CLEAR_MARGIN;
}

/** Eng yaxshi lokal match bor, lekin 2-o‘rin yaqin — faqat shunda AI. */
export function needsAmbiguousAi(
  candidates: Array<{ dist: number; cosine: number }>,
): boolean {
  const best = candidates[0];
  const second = candidates[1];
  if (!best || !isSamePerson(best.dist, best.cosine, FACE_MATCH_MAX)) return false;
  if (!second) return false;
  return second.dist - best.dist < FACE_AI_CLEAR_MARGIN;
}

export async function inspectEnrollFaceWithAi(
  liveSnapshot?: unknown,
): Promise<{ ok: true; quality: number } | { ok: false; error: string; code: string }> {
  if (!isFaceAiEnabled() || !FACE_AI_ENROLL_INSPECT) return { ok: true, quality: 1 };
  const live = toAiLiveDataUrl(typeof liveSnapshot === "string" ? liveSnapshot : null);
  if (!live) {
    return { ok: false, error: "Yuz rasmi olinmadi — kameraga tik qarab qayta urinib ko‘ring", code: "face_ai_no_photo" };
  }
  try {
    const inspect = parseFaceAiInspect(
      await openaiJson(
        [
          {
            role: "system",
            content:
              "You check a workplace selfie before saving it as the Face ID photo. " +
              "Accept if there is exactly one real human face (glasses, hijab, slight head turn, indoor light are OK). " +
              "Do not reject for uncertain eye openness or gaze. Reject only if no face, many faces, or a printed photo/screen. " +
              'JSON: {"ok":boolean,"faceCount":number,"quality":0-1,"reason":string}. reason must be empty when ok is true.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Save this as the enrolled Face ID photo? One live human face is enough." },
              imgPart(live),
            ],
          },
        ],
        180,
      ),
    );
    if (!inspect) {
      return {
        ok: false,
        error: "Yuzni oval ichiga oling va yorug‘ joyda qayta urinib ko‘ring.",
        code: "face_ai_enroll_quality",
      };
    }
    if (inspect.faceCount === 1) {
      logger.info({ event: "face_ai_enroll_inspect", quality: inspect.quality }, "face AI enroll inspect ok");
      return { ok: true, quality: Math.max(inspect.quality, 0.75) };
    }
    const error =
      inspect.faceCount > 1
        ? "Kadrda faqat siz bo‘ling — boshqa odam ko‘rinmasin."
        : "Yuz topilmadi. Kameraga qarab, yuzni oval ichiga tuting.";
    return { ok: false, error, code: "face_ai_enroll_quality" };
  } catch (err) {
    logger.warn({ event: "face_ai_enroll_inspect", err: err instanceof Error ? err.message : "error" }, "face AI enroll inspect failed");
    return {
      ok: false,
      error: "AI yuzni tasdiqlay olmadi. Internetingizni tekshirib, qayta urinib ko‘ring.",
      code: "face_ai_unavailable",
    };
  }
}

type PhotoRow = { id: number; userId: number; photoUrl: string | null };

async function loadFacePhotos(
  ids: number[],
): Promise<Map<number, { userId: number; dataUrl: string }>> {
  const out = new Map<number, { userId: number; dataUrl: string }>();
  if (!ids.length) return out;
  const { inArray } = await import("drizzle-orm");
  const { db, faceProfilesTable } = await import("@workspace/db");
  const rows = (await db
    .select({
      id: faceProfilesTable.id,
      userId: faceProfilesTable.userId,
      photoUrl: faceProfilesTable.photoUrl,
    })
    .from(faceProfilesTable)
    .where(inArray(faceProfilesTable.id, ids))) as PhotoRow[];
  for (const row of rows) {
    const dataUrl = toDataUrl(row.photoUrl);
    if (dataUrl) out.set(row.id, { userId: row.userId, dataUrl });
  }
  return out;
}

export async function rejectIfFaceTakenByAi(opts: {
  liveSnapshot?: unknown;
  neighborProfileIds: number[];
}): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  if (!isFaceAiEnabled() || !opts.neighborProfileIds.length || FACE_AI_DUP_MAX <= 0) return { ok: true };
  const live = toAiLiveDataUrl(typeof opts.liveSnapshot === "string" ? opts.liveSnapshot : null);
  if (!live) return { ok: true };
  const photos = await loadFacePhotos(opts.neighborProfileIds.slice(0, FACE_AI_DUP_MAX));
  for (const [id, photo] of photos) {
    try {
      const ai = await callOpenAiEnrollDuplicate(photo.dataUrl, live);
      if (isCertainEnrollDuplicate(ai)) {
        logger.info({ event: "face_ai_enroll_dup", profileId: id, confidence: ai.confidence }, "face AI enroll duplicate");
        return {
          ok: false,
          error: "Bu yuz allaqachon boshqa xodim Face ID siga biriktirilgan.",
          code: "face_already_taken",
        };
      }
    } catch (err) {
      logger.warn({ event: "face_ai_enroll_dup", err: err instanceof Error ? err.message : "error" }, "face AI dup check failed");
    }
  }
  return { ok: true };
}

export async function resolveLoginIdentityWithAi(opts: {
  liveSnapshot?: unknown;
  candidates: Array<{ id: number; userId: number; dist: number; cosine: number }>;
}): Promise<
  | { ok: true; id: number; userId: number; dist: number; cosine: number; confidence: number }
  | { ok: false; error: string; code: string }
> {
  const top = opts.candidates[0];
  if (!top) {
    return { ok: false, error: FACE_LOGIN_MSG_NOT_ENROLLED, code: "face_not_registered" };
  }

  if (!isFaceAiEnabled()) {
    if (!isSamePerson(top.dist, top.cosine, FACE_MATCH_MAX)) {
      return { ok: false, error: FACE_LOGIN_MSG_NOT_ENROLLED, code: "face_not_registered" };
    }
    return { ok: true, id: top.id, userId: top.userId, dist: top.dist, cosine: top.cosine, confidence: top.cosine };
  }

  /** Aniq lokal egasi — OpenAI chaqirilmaydi. */
  if (isClearLocalIdentity(opts.candidates)) {
    logger.info(
      {
        event: "face_ai_login",
        userId: top.userId,
        mode: "local_clear",
        dist: Number(top.dist.toFixed(4)),
        margin: opts.candidates[1] ? Number((opts.candidates[1].dist - top.dist).toFixed(4)) : null,
      },
      "face local clear — skip OpenAI",
    );
    return {
      ok: true,
      id: top.id,
      userId: top.userId,
      dist: top.dist,
      cosine: top.cosine,
      confidence: top.cosine,
    };
  }

  const live = toAiLiveDataUrl(typeof opts.liveSnapshot === "string" ? opts.liveSnapshot : null);
  const softOk = Number.isFinite(top.dist) && top.dist <= FACE_AI_SOFT_DIST;
  const photoIds = opts.candidates.slice(0, Math.max(FACE_AI_GALLERY_MAX, 3)).map((c) => c.id);
  const photos = await loadFacePhotos(photoIds);
  const hasDbPhoto = photos.size > 0;

  /**
   * Baza rasmi bor → AI bilan solishtirish (lokal «o‘xshamaydi» desa ham).
   * Rasm yo‘q va lokal ham uzoq → ro‘yxatdan o‘tmagan.
   */
  if (!hasDbPhoto) {
    if (isSamePerson(top.dist, top.cosine, FACE_MATCH_MAX) && !needsAmbiguousAi(opts.candidates)) {
      return {
        ok: true,
        id: top.id,
        userId: top.userId,
        dist: top.dist,
        cosine: top.cosine,
        confidence: top.cosine,
      };
    }
    const fail = loginFailFromScores({
      ambiguous: false,
      closestDist: top.dist,
      ownerMaxDist: FACE_MATCH_MAX,
    });
    logger.info(
      { event: "face_ai_login", mode: "no_db_photo", dist: Number(top.dist.toFixed(4)), code: fail.code },
      "face no enrolled photo — local only",
    );
    return { ok: false, error: fail.error, code: fail.code };
  }

  if (!live) {
    return {
      ok: false,
      error: "Jonli yuz rasmi olinmadi. Kameraga tik qarab qayta urinib ko‘ring.",
      code: "face_ai_no_photo",
    };
  }

  if (!softOk && !isSamePerson(top.dist, top.cosine, FACE_MATCH_MAX)) {
    const fail = loginFailFromScores({
      ambiguous: false,
      closestDist: top.dist,
      ownerMaxDist: FACE_MATCH_MAX,
    });
    logger.info(
      { event: "face_ai_login", mode: "too_far_for_ai", dist: Number(top.dist.toFixed(4)) },
      "face too far — skip OpenAI",
    );
    return { ok: false, error: fail.error, code: fail.code };
  }

  const gallery = opts.candidates
    .filter((c) => photos.has(c.id))
    .slice(0, Math.max(FACE_AI_GALLERY_MAX, 2))
    .map((c) => ({ id: c.id, dataUrl: photos.get(c.id)!.dataUrl }));

  try {
    const pairLimit = Math.max(FACE_AI_PAIRWISE_MAX, 1);
    const scores: FaceAiCandidateScore[] = [];
    for (const g of gallery.slice(0, pairLimit)) {
      const c = opts.candidates.find((x) => x.id === g.id);
      if (!c) continue;
      const ai = await callOpenAiFaceCompare(g.dataUrl, live);
      scores.push({
        faceProfileId: c.id,
        userId: c.userId,
        samePerson: ai.samePerson,
        confidence: ai.confidence,
        similarity: ai.similarity,
      });
      logger.info(
        {
          event: "face_ai_photo_compare",
          profileId: c.id,
          userId: c.userId,
          samePerson: ai.samePerson,
          confidence: ai.confidence,
          localDist: Number(c.dist.toFixed(4)),
        },
        "face AI vs DB photo",
      );
    }
    const winner = pickAiIdentityWinner(scores, { preferProfileId: top.id });
    if (!winner.ok) {
      const fail = loginFailFromScores({
        ambiguous: false,
        closestDist: top.dist,
        ownerMaxDist: FACE_MATCH_MAX,
      });
      return {
        ok: false,
        error: winner.code === "face_ai_mismatch"
          ? "Bazadagi rasm bilan mos kelmadi. Kameraga tik qarab, yorug‘ joyda qayta urinib ko‘ring."
          : fail.error,
        code: winner.code === "face_ai_mismatch" ? "face_ai_mismatch" : fail.code,
      };
    }
    const local = opts.candidates.find((c) => c.id === winner.faceProfileId)!;
    logger.info(
      {
        event: "face_ai_login",
        userId: winner.userId,
        confidence: winner.confidence,
        mode: "db_photo_match",
        detail: imageDetail(),
        model: process.env.OPENAI_FACE_MODEL?.trim() || "gpt-4.1-mini",
      },
      "face AI matched DB photo",
    );
    return {
      ok: true,
      id: winner.faceProfileId,
      userId: winner.userId,
      dist: local.dist,
      cosine: local.cosine,
      confidence: winner.confidence,
    };
  } catch (err) {
    logger.warn({ event: "face_ai_login", err: err instanceof Error ? err.message : "error" }, "face AI login failed");
    if (isSamePerson(top.dist, top.cosine, FACE_MATCH_MAX)) {
      return {
        ok: true,
        id: top.id,
        userId: top.userId,
        dist: top.dist,
        cosine: top.cosine,
        confidence: top.cosine,
      };
    }
    return {
      ok: false,
      error: "AI yuzni bazadagi rasm bilan solishtira olmadi. Qayta urinib ko‘ring.",
      code: "face_ai_unavailable",
    };
  }
}

/** Eski yo‘l: bitta profil. Yangi login resolveLoginIdentityWithAi ishlatadi. */
export async function verifyFaceWithAi(opts: {
  faceProfileId: number;
  liveSnapshot?: unknown;
  localDist: number;
  localCosine: number;
}): Promise<FaceAiGate> {
  const resolved = await resolveLoginIdentityWithAi({
    liveSnapshot: opts.liveSnapshot,
    candidates: [
      { id: opts.faceProfileId, userId: 0, dist: opts.localDist, cosine: opts.localCosine },
    ],
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      code: resolved.code === "face_ai_unavailable" ? "face_ai_low_confidence" : "face_ai_mismatch",
      confidence: 0,
    };
  }
  return {
    ok: true,
    source: "ai",
    confidence: resolved.confidence,
    similarity: resolved.confidence,
  };
}
