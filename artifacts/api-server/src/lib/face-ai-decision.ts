export const FACE_AI_WIN_MARGIN_DEFAULT = 0.12;

export const FACE_LOGIN_MSG_NOT_ENROLLED = "Bu yuz tizimda ro‘yxatdan o‘tmagan.";
export const FACE_LOGIN_MSG_LOOKALIKE =
  "Bu yuz tizimdagi boshqa xodim yuziga o‘xshash — mos kelmadi.";
export const FACE_LOGIN_MSG_AMBIGUOUS = "Bu yuz bir nechta xodimga o‘xshash — ochilmadi.";

/** Embedding yaqin, lekin AI “shu odam” demasa — o‘xshash; uzoq bo‘lsa — tizimda yo‘q. */
export function loginFailFromScores(opts: {
  ambiguous: boolean;
  closestDist: number | undefined;
  lookalikeMaxDist: number;
}): { error: string; code: "face_ai_mismatch" | "face_ai_low_confidence" | "face_not_registered" } {
  if (opts.ambiguous) {
    return { error: FACE_LOGIN_MSG_AMBIGUOUS, code: "face_ai_low_confidence" };
  }
  const dist = opts.closestDist;
  if (dist != null && Number.isFinite(dist) && dist <= opts.lookalikeMaxDist) {
    return { error: FACE_LOGIN_MSG_LOOKALIKE, code: "face_ai_mismatch" };
  }
  return { error: FACE_LOGIN_MSG_NOT_ENROLLED, code: "face_not_registered" };
}

export type FaceAiCompareResult = {
  samePerson: boolean;
  confidence: number;
  similarity: number;
};

export type FaceAiGate =
  | { ok: true; source: "ai" | "local_fallback"; confidence: number; similarity: number }
  | { ok: false; error: string; code: "face_ai_mismatch" | "face_ai_low_confidence"; confidence: number };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function parseFaceAiPayload(raw: unknown): FaceAiCompareResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const same =
    o.samePerson === true ||
    o.same_person === true ||
    o.match === true ||
    String(o.samePerson ?? o.same_person ?? "").toLowerCase() === "true";
  const confidence = clamp01(Number(o.confidence ?? o.score ?? 0));
  const similarity = clamp01(Number(o.similarity ?? o.confidence ?? 0));
  return { samePerson: same, confidence, similarity };
}

/** Galereyadan faqat ruxsat etilgan id — o‘xshash begona id qabul qilinmaydi. */
export function parseFaceAiIdentify(raw: unknown, allowedIds: number[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const allowed = new Set(allowedIds);
  const rawId = o.matchId ?? o.faceProfileId ?? o.id ?? o.winnerId;
  if (rawId === null || rawId === undefined || rawId === "" || rawId === "null") return null;
  const id = Number(rawId);
  if (!Number.isFinite(id) || !allowed.has(id)) return null;
  return id;
}

export function decideFaceAiGate(ai: FaceAiCompareResult): FaceAiGate {
  if (!ai.samePerson) {
    return {
      ok: false,
      error: FACE_LOGIN_MSG_LOOKALIKE,
      code: "face_ai_mismatch",
      confidence: ai.confidence,
    };
  }
  return {
    ok: true,
    source: "ai",
    confidence: ai.confidence,
    similarity: ai.similarity,
  };
}

export type FaceAiInspectResult = {
  ok: boolean;
  faceCount: number;
  quality: number;
  reason: string;
};

export function parseFaceAiInspect(raw: unknown): FaceAiInspectResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const faceCount = Math.max(0, Math.round(Number(o.faceCount ?? o.faces ?? 0)));
  const quality = clamp01(Number(o.quality ?? o.score ?? 0));
  const ok = o.ok === true || (faceCount === 1 && quality >= 0.75);
  const reason = String(o.reason ?? o.error ?? "").trim();
  return { ok, faceCount, quality, reason };
}

export type FaceAiCandidateScore = {
  faceProfileId: number;
  userId: number;
  samePerson: boolean;
  confidence: number;
  similarity: number;
};

/** Faqat bitta samePerson=true. Ikki kishi “ha” desa hech kim ochilmaydi. */
export function pickAiIdentityWinner(
  scores: FaceAiCandidateScore[],
):
  | { ok: true; faceProfileId: number; userId: number; confidence: number; similarity: number }
  | { ok: false; code: "face_ai_mismatch" | "face_ai_low_confidence" } {
  const hits = scores.filter((s) => s.samePerson);
  if (hits.length === 0) return { ok: false, code: "face_ai_mismatch" };
  if (hits.length > 1) return { ok: false, code: "face_ai_low_confidence" };
  const best = hits[0]!;
  return {
    ok: true,
    faceProfileId: best.faceProfileId,
    userId: best.userId,
    confidence: best.confidence,
    similarity: best.similarity,
  };
}
