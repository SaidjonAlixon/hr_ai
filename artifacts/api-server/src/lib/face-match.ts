import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, faceProfilesTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const FACE_DESCRIPTOR_LEN = 128;
/** Login: Euclidean yuqori chegara (kichikroq = qattiqroq). Env: FACE_MATCH_THRESHOLD */
export const FACE_MATCH_MAX = envNum("FACE_MATCH_THRESHOLD", 0.26);
/** Cosine past chegara. Env: FACE_MATCH_MIN_COSINE */
export const FACE_MATCH_MIN_COSINE = envNum("FACE_MATCH_MIN_COSINE", 0.968);
export const FACE_AMBIGUOUS_MARGIN = envNum("FACE_AMBIGUOUS_MARGIN", 0.1);
export const FACE_AMBIGUOUS_RATIO = envNum("FACE_AMBIGUOUS_RATIO", 0.62);
/** Ro‘yxat: boshqa xodimga yaqin yuz. Env: FACE_ENROLLMENT_THRESHOLD */
export const FACE_ENROLL_BLOCK_MAX = envNum("FACE_ENROLLMENT_THRESHOLD", 0.28);
export const FACE_SIMILAR_WARN = envNum("FACE_SIMILAR_WARN", 0.36);
/** 0..1 liveness ball. Env: LIVENESS_THRESHOLD */
export const LIVENESS_THRESHOLD = envNum("LIVENESS_THRESHOLD", 0.55);
export const FACE_STORE_PHOTOS = process.env.FACE_STORE_PHOTOS !== "0" && process.env.FACE_STORE_PHOTOS !== "false";

export type LivenessProof = {
  blinked?: boolean;
  poses?: string[];
  motion?: number;
  score?: number;
};

export function evaluateLiveness(
  proof: LivenessProof | undefined,
  mode: "enroll" | "login",
): { ok: true; score: number } | { ok: false; error: string; code: string } {
  const blinked = Boolean(proof?.blinked);
  const poses = new Set((proof?.poses ?? []).filter(Boolean));
  const motion = Number(proof?.motion ?? 0);
  let score = Number(proof?.score ?? 0);
  if (!Number.isFinite(score)) score = 0;
  if (blinked) score = Math.max(score, score + 0);
  const computed =
    (mode === "enroll" ? (poses.size >= 3 ? 0.55 : poses.size >= 2 ? 0.25 : 0) : poses.size >= 2 ? 0.5 : poses.size >= 1 ? 0.2 : 0) +
    (motion >= 0.05 ? 0.35 : motion >= 0.03 ? 0.2 : 0);
  const finalScore = Math.max(score, computed);

  if (finalScore < LIVENESS_THRESHOLD || (mode === "enroll" && poses.size < 3) || motion < 0.03) {
    logger.warn({ mode, blinked, poses: [...poses], motion, finalScore }, "face liveness failed");
    return {
      ok: false,
      error: "Yuzingiz tasdiqlanmadi. Kamera oldida haqiqiy odam ekanligingizni tasdiqlang.",
      code: "liveness_failed",
    };
  }
  logger.info({ mode, finalScore, motion, poses: poses.size }, "face liveness ok");
  return { ok: true, score: finalScore };
}

function descriptorKey(): Buffer | null {
  const s = process.env.FACE_DESCRIPTOR_KEY?.trim();
  if (!s) return null;
  return scryptSync(s, "hr-face-id-v1", 32);
}

export function packDescriptors(list: number[][]): string {
  const json = JSON.stringify(list);
  const key = descriptorKey();
  if (!key) return json;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

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

function faceDistance(a: number[], b: number[]): { dist: number; cosine: number } {
  const na = l2normalize(a);
  const nb = l2normalize(b);
  return { dist: euclidean(na, nb), cosine: cosineSim(na, nb) };
}

function isSamePerson(dist: number, cosine: number, maxDist: number): boolean {
  return dist <= maxDist && cosine >= FACE_MATCH_MIN_COSINE;
}

export type FaceHit = { id: number; userId: number; dist: number };

export type FaceNeighbor = FaceHit & {
  fullName: string | null;
  login: string | null;
  role: string | null;
};

type CachedFaceRow = {
  id: number;
  userId: number;
  descriptor: number[];
};

let faceCache: { at: number; rows: CachedFaceRow[] } | null = null;
const FACE_CACHE_TTL_MS = 60_000;

async function loadFaceRows(): Promise<CachedFaceRow[]> {
  const now = Date.now();
  if (faceCache && now - faceCache.at < FACE_CACHE_TTL_MS) {
    return faceCache.rows;
  }
  const raw = await db
    .select({
      id: faceProfilesTable.id,
      userId: faceProfilesTable.userId,
      descriptor: faceProfilesTable.descriptor,
    })
    .from(faceProfilesTable);

  const rows: CachedFaceRow[] = [];
  for (const row of raw) {
    const list = parseStoredList(row.descriptor);
    for (const descriptor of list) {
      rows.push({ id: row.id, userId: row.userId, descriptor });
    }
  }
  faceCache = { at: now, rows };
  return rows;
}

/** Enroll / delete dan keyin cache ni yangilash */
export function invalidateFaceCache(): void {
  faceCache = null;
}

function parseStoredList(raw: string): number[][] {
  try {
    let text = raw;
    if (raw.startsWith("enc:v1:")) {
      const key = descriptorKey();
      if (!key) return [];
      const parts = raw.split(":");
      const iv = Buffer.from(parts[2] ?? "", "base64");
      const tag = Buffer.from(parts[3] ?? "", "base64");
      const data = Buffer.from(parts[4] ?? "", "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      text = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    }
    const stored = JSON.parse(text) as unknown;
    if (!Array.isArray(stored) || !stored.length) return [];
    if (typeof stored[0] === "number") {
      const one = parseFaceDescriptor(stored);
      return one ? [one] : [];
    }
    const out: number[][] = [];
    for (const item of stored) {
      const d = parseFaceDescriptor(item);
      if (d) out.push(d);
    }
    return out;
  } catch {
    return [];
  }
}

/** Eng yaqin yuz (ixtiyoriy maxDist) */
export async function findClosestFace(
  descriptor: number[],
  opts?: { excludeUserId?: number; maxDist?: number },
): Promise<FaceHit | null> {
  const maxDist = opts?.maxDist ?? FACE_MATCH_MAX;
  const rows = await loadFaceRows();
  let best: FaceHit | null = null;
  for (const row of rows) {
    if (opts?.excludeUserId != null && row.userId === opts.excludeUserId) continue;
    const { dist, cosine } = faceDistance(descriptor, row.descriptor);
    if (!isSamePerson(dist, cosine, maxDist)) continue;
    if (!best || dist < best.dist) best = { id: row.id, userId: row.userId, dist };
  }
  if (!best) return null;
  return best;
}

/** Eng yaqin N ta qo‘shni (admin / enroll diagnostikasi) */
export async function findNearestFaces(
  descriptor: number[],
  opts?: { excludeUserId?: number; limit?: number; maxDist?: number },
): Promise<FaceHit[]> {
  const limit = opts?.limit ?? 5;
  const maxDist = opts?.maxDist ?? Number.POSITIVE_INFINITY;
  const rows = await loadFaceRows();
  const hits: FaceHit[] = [];
  for (const row of rows) {
    if (opts?.excludeUserId != null && row.userId === opts.excludeUserId) continue;
    const { dist, cosine } = faceDistance(descriptor, row.descriptor);
    if (!Number.isFinite(maxDist)) {
      hits.push({ id: row.id, userId: row.userId, dist });
      continue;
    }
    if (!isSamePerson(dist, cosine, maxDist)) continue;
    hits.push({ id: row.id, userId: row.userId, dist });
  }
  hits.sort((a, b) => a.dist - b.dist);
  return hits.slice(0, limit);
}

export async function ownerNameOfUser(userId: number): Promise<string | null> {
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName ?? null;
}

export async function enrichFaceHits(hits: FaceHit[]): Promise<FaceNeighbor[]> {
  if (!hits.length) return [];
  const ids = [...new Set(hits.map((h) => h.userId))];
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      login: usersTable.login,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  const byId = new Map(users.map((u) => [u.id, u]));
  return hits.map((h) => {
    const u = byId.get(h.userId);
    return {
      ...h,
      fullName: u?.fullName ?? null,
      login: u?.login ?? null,
      role: u?.role ?? null,
    };
  });
}

/** Login / davomat: bitta aniq egasi bo‘lishi shart */
export async function matchFaceForAuth(
  descriptor: number[],
): Promise<
  | { ok: true; id: number; userId: number; dist: number }
  | { ok: false; error: string; code: string; neighbors?: FaceNeighbor[] }
> {
  const rows = await loadFaceRows();
  let best: FaceHit | null = null;
  let second: FaceHit | null = null;
  let bestCosine = 0;
  let secondCosine = 0;
  for (const row of rows) {
    const { dist, cosine } = faceDistance(descriptor, row.descriptor);
    const hit = { id: row.id, userId: row.userId, dist };
    if (!best || dist < best.dist) {
      if (best && best.userId !== hit.userId) {
        second = best;
        secondCosine = bestCosine;
      }
      best = hit;
      bestCosine = cosine;
    } else if (hit.userId !== best.userId && (!second || dist < second.dist)) {
      second = hit;
      secondCosine = cosine;
    }
  }

  if (!best || !isSamePerson(best.dist, bestCosine, FACE_MATCH_MAX)) {
    return {
      ok: false,
      error: "Bu yuz aniqlanmadi. Avval tizimga kirib Face ID ni ro‘yxatdan o‘tkazing.",
      code: "face_not_registered",
    };
  }

  const secondTooClose =
    Boolean(second) &&
    second!.dist <= FACE_MATCH_MAX + 0.04 &&
    (isSamePerson(second!.dist, secondCosine, FACE_MATCH_MAX) ||
      second!.dist - best.dist < FACE_AMBIGUOUS_MARGIN ||
      best.dist / Math.max(second!.dist, 1e-6) > FACE_AMBIGUOUS_RATIO);
  if (secondTooClose && second) {
    const neighbors = await enrichFaceHits([best, second]);
    const names = neighbors
      .map((n) => n.fullName)
      .filter(Boolean)
      .join(" va ");
    return {
      ok: false,
      error: names
        ? `Bu yuz bir nechta profilga o‘xshaydi (${names}). Admin Face ID ni tozalab, har bir xodim qayta ro‘yxatdan o‘tsin.`
        : "Bu yuz bir nechta profilga o‘xshaydi — Face ID faqat bitta xodimga birikadi.",
      code: "face_ambiguous",
      neighbors,
    };
  }

  return { ok: true, id: best.id, userId: best.userId, dist: best.dist };
}

/** Ikki descriptor orasidagi masofa (admin jadval) */
export function distanceBetweenDescriptors(aJson: string, bJson: string): number | null {
  const a = parseStored(aJson);
  const b = parseStored(bJson);
  if (!a || !b) return null;
  return faceDistance(a, b).dist;
}
