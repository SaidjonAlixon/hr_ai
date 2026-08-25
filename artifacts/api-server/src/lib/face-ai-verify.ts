/**
 * OpenAI Vision — Face ID enroll + login tasdiq.
 * Lokal 128-d embedding birinchi filtr. Yakuniy shaxsni AI tanlaydi.
 * Kalit faqat process.env (backend .env).
 */
import { logger } from "./logger";
import {
  decideFaceAiGate,
  parseFaceAiIdentify,
  parseFaceAiInspect,
  parseFaceAiPayload,
  pickAiIdentityWinner,
  type FaceAiCandidateScore,
  type FaceAiCompareResult,
  type FaceAiGate,
} from "./face-ai-decision";

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

export function isFaceAiEnabled(): boolean {
  if (!envFlag("FACE_AI_VERIFY", true)) return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function toDataUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("data:image/")) return null;
  if (s.length < 80 || s.length > 1_200_000) return null;
  return s;
}

async function openaiJson(
  messages: unknown[],
  maxTokens = 220,
): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const model = process.env.OPENAI_FACE_MODEL?.trim() || "gpt-4o";
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
          { type: "image_url", image_url: { url: enrolledDataUrl, detail: "high" } },
          { type: "image_url", image_url: { url: liveDataUrl, detail: "high" } },
        ],
      },
    ]),
  );
  if (!parsed) throw new Error("openai_bad_json");
  return parsed;
}

const GALLERY_MAX = 10;

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
    { type: "image_url", image_url: { url: liveDataUrl, detail: "high" } },
  ];
  for (const g of gallery) {
    content.push({ type: "text", text: `ENROLLED id=${g.id}:` });
    content.push({ type: "image_url", image_url: { url: g.dataUrl, detail: "high" } });
  }
  const raw = await openaiJson(
    [
      {
        role: "system",
        content:
          "You identify one person from a gallery of enrolled workplace photos. " +
          "Use full-face identity (eyes, nose, jaw, moles), not clothing or background. " +
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

export async function inspectEnrollFaceWithAi(
  liveSnapshot?: unknown,
): Promise<{ ok: true; quality: number } | { ok: false; error: string; code: string }> {
  if (!isFaceAiEnabled()) return { ok: true, quality: 1 };
  const live = toDataUrl(typeof liveSnapshot === "string" ? liveSnapshot : null);
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
              { type: "image_url", image_url: { url: live, detail: "high" } },
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
  if (!isFaceAiEnabled() || !opts.neighborProfileIds.length) return { ok: true };
  const live = toDataUrl(typeof opts.liveSnapshot === "string" ? opts.liveSnapshot : null);
  if (!live) return { ok: true };
  const photos = await loadFacePhotos(opts.neighborProfileIds.slice(0, 8));
  for (const [id, photo] of photos) {
    try {
      const ai = await callOpenAiFaceCompare(photo.dataUrl, live);
      if (ai.samePerson) {
        logger.info({ event: "face_ai_enroll_dup", profileId: id, confidence: ai.confidence }, "face AI enroll duplicate");
        return {
          ok: false,
          error: "Bu yuz allaqachon boshqa xodim Face ID siga biriktirilgan.",
          code: "face_already_taken",
        };
      }
    } catch (err) {
      logger.warn({ event: "face_ai_enroll_dup", err: err instanceof Error ? err.message : "error" }, "face AI dup check failed");
      return {
        ok: false,
        error: "AI yuzni tasdiqlay olmadi. Boshqa odamning yuzini yozib qo‘ymaslik uchun qayta urinib ko‘ring.",
        code: "face_ai_unavailable",
      };
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
  if (!isFaceAiEnabled()) {
    const c = opts.candidates[0];
    if (!c) return { ok: false, error: "Yuz aniqlanmadi", code: "face_not_registered" };
    return { ok: true, id: c.id, userId: c.userId, dist: c.dist, cosine: c.cosine, confidence: c.cosine };
  }
  const live = toDataUrl(typeof opts.liveSnapshot === "string" ? opts.liveSnapshot : null);
  if (!live) {
    return {
      ok: false,
      error: "Jonli yuz rasmi yo‘q. Kameraga qarab Face ID ni qayta urinib ko‘ring.",
      code: "face_ai_no_photo",
    };
  }
  const photos = await loadFacePhotos(opts.candidates.map((c) => c.id));
  if (!photos.size) {
    return {
      ok: false,
      error: "Face ID rasmi yo‘q. Avval yuzni qayta ro‘yxatdan o‘tkazing.",
      code: "face_ai_no_enrolled_photo",
    };
  }
  const gallery = opts.candidates
    .filter((c) => photos.has(c.id))
    .slice(0, GALLERY_MAX)
    .map((c) => ({ id: c.id, dataUrl: photos.get(c.id)!.dataUrl }));
  try {
    const matchId = await callOpenAiFaceIdentify(live, gallery);
    if (matchId != null) {
      const enrolled = photos.get(matchId);
      const local = opts.candidates.find((c) => c.id === matchId);
      if (!enrolled || !local) {
        return { ok: false, error: "Yuz mos kelmadi", code: "face_ai_mismatch" };
      }
      const confirm = await callOpenAiFaceCompare(enrolled.dataUrl, live);
      if (!confirm.samePerson) {
        return {
          ok: false,
          error: "Yuz mos kelmadi — bu boshqa odamga o‘xshaydi.",
          code: "face_ai_mismatch",
        };
      }
      logger.info(
        { event: "face_ai_login", userId: local.userId, matchId, gallery: gallery.length },
        "face AI gallery identity",
      );
      return {
        ok: true,
        id: local.id,
        userId: local.userId,
        dist: local.dist,
        cosine: local.cosine,
        confidence: confirm.confidence,
      };
    }

    const scores: FaceAiCandidateScore[] = [];
    for (const g of gallery) {
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
    }
    const winner = pickAiIdentityWinner(scores);
    if (!winner.ok) {
      return {
        ok: false,
        error:
          winner.code === "face_ai_low_confidence"
            ? "Yuz bir nechta xodimga o‘xshaydi. Kameraga tik qarang."
            : "Yuz mos kelmadi — bu boshqa odamga o‘xshaydi.",
        code: winner.code,
      };
    }
    const local = opts.candidates.find((c) => c.id === winner.faceProfileId)!;
    logger.info(
      { event: "face_ai_login", userId: winner.userId, confidence: winner.confidence, mode: "pairwise" },
      "face AI pairwise identity",
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
    return {
      ok: false,
      error: "AI yuzni tasdiqlay olmadi. Qayta urinib ko‘ring — boshqa odam ochilmaydi.",
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
