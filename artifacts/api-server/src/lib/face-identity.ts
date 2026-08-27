import { createHmac, timingSafeEqual } from "crypto";

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const FACE_DESCRIPTOR_LEN = 128;

/**
 * face-api.js FaceRecognitionNet — 128-d FaceNet uslubidagi embedding.
 * L2-norm: dist = sqrt(2 − 2·cosine).
 * Kutubxona odatiy (normasiz) cutoff ≈ 0.6.
 * L2-normdan keyin (shu loyiha):
 *  — bir odam, yorug‘lik/burchak: ~0.12–0.38
 *  — o‘xshash boshqa odam: ~0.45–0.70
 *  — begona: odatda > 0.55
 * Login: dist ≤ 0.34 va cosine ≥ 0.942 (FP past).
 * Enroll block: faqat markaz kadr, dist ≤ 0.36 (yonbosh kadrlar boshqa odamga o‘xshab ketmasin).
 */
export const FACE_MATCH_MAX = envNum("FACE_MATCH_THRESHOLD", 0.34);
export const FACE_MATCH_MIN_COSINE = envNum("FACE_MATCH_MIN_COSINE", 0.942);
export const FACE_AMBIGUOUS_MARGIN = envNum("FACE_AMBIGUOUS_MARGIN", 0.08);
export const FACE_AMBIGUOUS_RATIO = envNum("FACE_AMBIGUOUS_RATIO", 0.72);
/** Faqat deyarli bir xil vektor — hijob/o‘xshash yuzni yangi akkauntga yozishni to‘xtatmasin. */
export const FACE_ENROLL_BLOCK_MAX = envNum("FACE_ENROLLMENT_THRESHOLD", 0.22);
export const FACE_SIMILAR_WARN = envNum("FACE_SIMILAR_WARN", 0.5);
export const LIVENESS_THRESHOLD = envNum("LIVENESS_THRESHOLD", 0.55);
/** Telefon/print: deyarli harakatsiz kadr — rad. */
export const LIVENESS_MIN_MOTION = envNum("LIVENESS_MIN_MOTION", 0.012);
export const FACE_CHALLENGE_TTL_MS = 120_000;

export type FaceHit = { id: number; userId: number; dist: number; cosine: number };
export type StoredFace = { id: number; userId: number; descriptor: number[] };

export type FaceChallengeStep = {
  key: string;
  pose?: "center" | "left" | "right" | "up" | "down";
  blink?: boolean;
  need: number;
};

export type LivenessProof = {
  blinked?: boolean;
  poses?: string[];
  steps?: string[];
  motion?: number;
  score?: number;
  challenge?: string;
};

export function parseFaceDescriptor(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== FACE_DESCRIPTOR_LEN) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export function cosineSim(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

export function faceDistance(a: number[], b: number[]): { dist: number; cosine: number } {
  const na = l2normalize(a);
  const nb = l2normalize(b);
  return { dist: euclidean(na, nb), cosine: cosineSim(na, nb) };
}

export function isSamePerson(dist: number, cosine: number, maxDist = FACE_MATCH_MAX): boolean {
  return dist <= maxDist && cosine >= FACE_MATCH_MIN_COSINE;
}

export function isEnrollConflict(dist: number, cosine = 1): boolean {
  return dist <= FACE_ENROLL_BLOCK_MAX && cosine >= 0.97;
}

export function buildFaceChallengeSteps(mode: "enroll" | "login"): FaceChallengeStep[] {
  /** Markaz + ko‘z yumish — jonsiz rasm/video replay qiyinlashadi. */
  return [
    { key: "center", pose: "center", need: mode === "enroll" ? 2 : 1 },
    { key: "blink", blink: true, need: 1 },
  ];
}

function challengeSecret(): string {
  return (
    process.env.FACE_DESCRIPTOR_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "hr-face-challenge-dev"
  );
}

export function issueFaceChallenge(mode: "enroll" | "login"): { token: string; steps: FaceChallengeStep[] } {
  const steps = buildFaceChallengeSteps(mode);
  const exp = Date.now() + FACE_CHALLENGE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ mode, steps, exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", challengeSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, steps };
}

export function readFaceChallenge(token: string | undefined): {
  mode: "enroll" | "login";
  steps: FaceChallengeStep[];
  exp: number;
} | null {
  if (!token || !token.includes(".")) return null;
  const dot = token.lastIndexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = createHmac("sha256", challengeSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      mode?: string;
      steps?: FaceChallengeStep[];
      exp?: number;
    };
    if (json.mode !== "enroll" && json.mode !== "login") return null;
    if (!Array.isArray(json.steps) || !json.steps.length) return null;
    if (!Number.isFinite(json.exp) || Date.now() > Number(json.exp)) return null;
    return { mode: json.mode, steps: json.steps, exp: Number(json.exp) };
  } catch {
    return null;
  }
}

export function evaluateLiveness(
  proof: LivenessProof | undefined,
  mode: "enroll" | "login",
): { ok: true; score: number; quality: number } | { ok: false; error: string; code: string } {
  const issued = readFaceChallenge(proof?.challenge);
  if (!issued || issued.mode !== mode) {
    return {
      ok: false,
      error: "Yuzingiz tasdiqlanmadi. Kamera oldida haqiqiy odam ekanligingizni tasdiqlang.",
      code: "liveness_failed",
    };
  }
  const completed = new Set(
    [...(proof?.steps ?? []), ...(proof?.poses ?? [])].filter(Boolean).map(String),
  );
  if (proof?.blinked) completed.add("blink");
  const missing = issued.steps.filter((s) => !completed.has(s.key) && !completed.has(s.pose ?? "")).map((s) => s.key);
  const motion = Number(proof?.motion ?? 0);
  if (missing.length) {
    return {
      ok: false,
      error: "Yuzingiz tasdiqlanmadi. Kameraga qarab oval ichida turing, ko‘zingizni yumib oching.",
      code: "liveness_failed",
    };
  }
  if (!Number.isFinite(motion) || motion < LIVENESS_MIN_MOTION) {
    return {
      ok: false,
      error: "Jonli yuz kerak. Telefon yoki bosma rasm qabul qilinmaydi — kameraga o‘zingiz qarang.",
      code: "liveness_failed",
    };
  }
  const needBlink = issued.steps.some((s) => s.blink);
  if (needBlink && !proof?.blinked && !completed.has("blink")) {
    return {
      ok: false,
      error: "Ko‘zingizni yumib oching — jonsiz rasm qabul qilinmaydi.",
      code: "liveness_failed",
    };
  }
  const computed = 0.62 + (motion >= 0.02 ? 0.25 : 0.15);
  return { ok: true, score: computed, quality: Math.min(1, computed) };
}

export function bestPerUser(probes: number[][], rows: StoredFace[]): FaceHit[] {
  const byUser = new Map<number, FaceHit>();
  for (const probe of probes) {
    for (const row of rows) {
      const { dist, cosine } = faceDistance(probe, row.descriptor);
      const prev = byUser.get(row.userId);
      if (!prev || dist < prev.dist) {
        byUser.set(row.userId, { id: row.id, userId: row.userId, dist, cosine });
      }
    }
  }
  return [...byUser.values()].sort((a, b) => a.dist - b.dist);
}

/** Login identifikasiya — faqat 1-kadr (markaz). Yonbosh kadr boshqa odamga o‘xshab ketmasin. */
export function identityProbes(probes: number[][]): number[][] {
  return probes[0] ? [probes[0]] : [];
}

export function pickAuthMatch(
  probes: number[][],
  rows: StoredFace[],
):
  | { ok: true; id: number; userId: number; dist: number; cosine: number }
  | { ok: false; code: "face_not_registered" | "face_ambiguous"; best?: FaceHit; second?: FaceHit } {
  const ranked = bestPerUser(identityProbes(probes), rows);
  const best = ranked[0];
  if (!best || !isSamePerson(best.dist, best.cosine, FACE_MATCH_MAX)) {
    return { ok: false, code: "face_not_registered", best };
  }
  /** Eng yaqin yagona egasi — o‘chirish yo‘q, boshqa xodim ham yopilmaydi. */
  return { ok: true, id: best.id, userId: best.userId, dist: best.dist, cosine: best.cosine };
}

/** AI galereyasi — embedding faqat tartiblaydi, shaxsni tanlamaydi. Dist filtri yo‘q. */
export function listAuthCandidates(
  probes: number[][],
  rows: StoredFace[],
  limit = 12,
): FaceHit[] {
  return bestPerUser(identityProbes(probes), rows).slice(0, limit);
}

export function findEnrollConflicts(
  probes: number[][],
  rows: StoredFace[],
  excludeUserId?: number,
): FaceHit[] {
  const ranked = bestPerUser(probes, rows).filter(
    (h) => h.userId !== excludeUserId && isEnrollConflict(h.dist, h.cosine),
  );
  return ranked.slice(0, 5);
}
