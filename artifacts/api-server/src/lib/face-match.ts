import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, faceProfilesTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  FACE_DESCRIPTOR_LEN,
  FACE_ENROLL_BLOCK_MAX,
  FACE_MATCH_MAX,
  FACE_MATCH_MIN_COSINE,
  FACE_SIMILAR_WARN,
  LIVENESS_THRESHOLD,
  evaluateLiveness,
  faceDistance,
  findEnrollConflicts,
  isSamePerson,
  parseFaceDescriptor,
  pickAuthMatch,
  listAuthCandidates,
  type FaceHit as CoreHit,
  type LivenessProof,
  type StoredFace,
} from "./face-identity";

export {
  FACE_DESCRIPTOR_LEN,
  FACE_ENROLL_BLOCK_MAX,
  FACE_MATCH_MAX,
  FACE_MATCH_MIN_COSINE,
  FACE_SIMILAR_WARN,
  LIVENESS_THRESHOLD,
  evaluateLiveness,
  faceDistance,
  parseFaceDescriptor,
  type LivenessProof,
};

export const FACE_STORE_PHOTOS = process.env.FACE_STORE_PHOTOS !== "0" && process.env.FACE_STORE_PHOTOS !== "false";

export type FaceHit = { id: number; userId: number; dist: number };

export type FaceNeighbor = FaceHit & {
  fullName: string | null;
  login: string | null;
  role: string | null;
};

type CachedFaceRow = StoredFace;

let faceCache: { at: number; rows: CachedFaceRow[] } | null = null;
const FACE_CACHE_TTL_MS = 60_000;

function descriptorKey(): Buffer | null {
  const s = process.env.FACE_DESCRIPTOR_KEY?.trim() || process.env.SESSION_SECRET?.trim();
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

export function invalidateFaceCache(): void {
  faceCache = null;
}

export async function findClosestFace(
  descriptor: number[],
  opts?: { excludeUserId?: number; maxDist?: number },
): Promise<FaceHit | null> {
  const maxDist = opts?.maxDist ?? FACE_MATCH_MAX;
  const rows = await loadFaceRows();
  const hits = findEnrollConflicts([descriptor], rows, opts?.excludeUserId);
  const best = hits.find((h) => h.dist <= maxDist) ?? null;
  return best ? { id: best.id, userId: best.userId, dist: best.dist } : null;
}

export async function findNearestFaces(
  descriptor: number[],
  opts?: { excludeUserId?: number; limit?: number; maxDist?: number },
): Promise<FaceHit[]> {
  const limit = opts?.limit ?? 5;
  const maxDist = opts?.maxDist ?? Number.POSITIVE_INFINITY;
  const rows = await loadFaceRows();
  const probes = [descriptor];
  const ranked = findEnrollConflicts(probes, rows, opts?.excludeUserId);
  const all =
    Number.isFinite(maxDist) && maxDist < 10
      ? ranked.filter((h) => h.dist <= maxDist)
      : (await loadFaceRows()
          .then((r) => r)
          .then(() => ranked));
  if (!Number.isFinite(maxDist) || maxDist >= 10) {
    const byUser = new Map<number, CoreHit>();
    for (const row of rows) {
      if (opts?.excludeUserId != null && row.userId === opts.excludeUserId) continue;
      const { dist, cosine } = faceDistance(descriptor, row.descriptor);
      const prev = byUser.get(row.userId);
      if (!prev || dist < prev.dist) byUser.set(row.userId, { id: row.id, userId: row.userId, dist, cosine });
    }
    return [...byUser.values()]
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map((h) => ({ id: h.id, userId: h.userId, dist: h.dist }));
  }
  return all.slice(0, limit).map((h) => ({ id: h.id, userId: h.userId, dist: h.dist }));
}

export async function findDuplicateEnrollHits(
  probes: number[][],
  excludeUserId?: number,
): Promise<FaceHit[]> {
  const rows = await loadFaceRows();
  return findEnrollConflicts(probes, rows, excludeUserId).map((h) => ({
    id: h.id,
    userId: h.userId,
    dist: h.dist,
  }));
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

export async function matchFaceForAuth(
  descriptor: number[] | number[][],
): Promise<
  | { ok: true; id: number; userId: number; dist: number; cosine: number }
  | { ok: false; error: string; code: string; neighbors?: FaceNeighbor[] }
> {
  const probes = (Array.isArray(descriptor[0]) ? descriptor : [descriptor]) as number[][];
  const rows = await loadFaceRows();
  const picked = pickAuthMatch(probes, rows);
  if (picked.ok) {
    logger.info(
      {
        event: "face_verify",
        ok: true,
        userId: picked.userId,
        dist: Number(picked.dist.toFixed(4)),
        cosine: Number(picked.cosine.toFixed(4)),
        threshold: FACE_MATCH_MAX,
        probes: probes.length,
      },
      "face match ok",
    );
    return picked;
  }
  logger.info(
    {
      event: "face_verify",
      ok: false,
      code: picked.code,
      dist: picked.best ? Number(picked.best.dist.toFixed(4)) : null,
      threshold: FACE_MATCH_MAX,
    },
    "face match failed",
  );
  if (picked.code === "face_ambiguous" && picked.best && picked.second) {
    const neighbors = await enrichFaceHits([
      { id: picked.best.id, userId: picked.best.userId, dist: picked.best.dist },
      { id: picked.second.id, userId: picked.second.userId, dist: picked.second.dist },
    ]);
    return {
      ok: false,
      error: "Yuz aniq o‘qilmadi. Kameraga tik qarang — yuz oval ichida bo‘lsin.",
      code: "face_ambiguous",
      neighbors,
    };
  }
  return {
    ok: false,
    error: "Bu yuz tizimda ro‘yxatdan o‘tmagan. Avval tizimga kirib Face ID ni ulashing.",
    code: "face_not_registered",
  };
}

export async function matchFaceForAuthWithAi(
  descriptor: number[] | number[][],
  liveSnapshot?: unknown,
): Promise<
  | { ok: true; id: number; userId: number; dist: number; cosine: number }
  | { ok: false; error: string; code: string; neighbors?: FaceNeighbor[] }
> {
  const {
    FACE_AI_GALLERY_MAX,
    inspectLiveAntiSpoof,
    isFaceAiEnabled,
    resolveLoginIdentityWithAi,
  } = await import("./face-ai-verify");
  if (!isFaceAiEnabled()) return matchFaceForAuth(descriptor);

  const anti = await inspectLiveAntiSpoof(liveSnapshot, "login");
  if (!anti.ok) return { ok: false, error: anti.error, code: anti.code };

  const probes = (Array.isArray(descriptor[0]) ? descriptor : [descriptor]) as number[][];
  const rows = await loadFaceRows();
  const candidates = listAuthCandidates(probes, rows, Math.max(FACE_AI_GALLERY_MAX, 3));
  if (!candidates.length) {
    return {
      ok: false,
      error: "Bu yuz tizimda ro‘yxatdan o‘tmagan.",
      code: "face_not_registered",
    };
  }
  const resolved = await resolveLoginIdentityWithAi({
    liveSnapshot,
    skipAntiSpoof: true,
    candidates: candidates.map((c) => ({ id: c.id, userId: c.userId, dist: c.dist, cosine: c.cosine })),
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, code: resolved.code };
  }
  logger.info(
    {
      event: "face_verify_ai",
      ok: true,
      userId: resolved.userId,
      dist: Number(resolved.dist.toFixed(4)),
      confidence: resolved.confidence,
    },
    "face AI identity ok",
  );
  return {
    ok: true,
    id: resolved.id,
    userId: resolved.userId,
    dist: resolved.dist,
    cosine: resolved.cosine,
  };
}

/**
 * Login/parol bilan kirilgan akkaunt — live yuz faqat shu user Face ID si bilan.
 * Boshqa odam → «Siz {ism} emassiz».
 * Haqiqiy egasi yorug‘lik farqi bilan rad etilmasin (yumshoq lokal + AI).
 */
export async function matchFaceForOwnerWithAi(
  userId: number,
  descriptor: number[] | number[][],
  liveSnapshot?: unknown,
  ownerFullName?: string,
): Promise<
  | { ok: true; id: number; userId: number; dist: number; cosine: number }
  | { ok: false; error: string; code: string; fullName?: string }
> {
  const name = (ownerFullName || "").trim() || "shu akkaunt egasi";
  const notOwner = {
    ok: false as const,
    error: `Siz ${name} emassiz. Bu yuz login/parol bilan kirilgan akkauntga tegishli emas.`,
    code: "face_not_owner",
    fullName: name,
  };
  /** Owner 1:1 — gallery dan yumshoqroq (yorug‘lik/burchak). */
  const OWNER_DIST_OK = Math.max(FACE_MATCH_MAX, envNum("FACE_OWNER_MATCH_MAX", 0.48));
  const OWNER_COS_OK = Math.min(FACE_MATCH_MIN_COSINE, envNum("FACE_OWNER_MIN_COSINE", 0.88));

  const [profile] = await db
    .select({
      id: faceProfilesTable.id,
      userId: faceProfilesTable.userId,
      descriptor: faceProfilesTable.descriptor,
    })
    .from(faceProfilesTable)
    .where(eq(faceProfilesTable.userId, userId))
    .limit(1);

  if (!profile) {
    return {
      ok: false,
      error: `${name} akkauntida Face ID ulanmagan. Avval yuzni ro‘yxatdan o‘tkazing.`,
      code: "face_not_registered",
      fullName: name,
    };
  }

  const probes = (Array.isArray(descriptor[0]) ? descriptor : [descriptor]) as number[][];
  const stored = parseStoredList(profile.descriptor);
  if (!stored.length || !probes[0]) {
    return {
      ok: false,
      error: "Face ID shabloni buzilgan — qayta ulashing.",
      code: "face_not_registered",
      fullName: name,
    };
  }

  let bestDist = Number.POSITIVE_INFINITY;
  let bestCosine = 0;
  for (const probe of probes) {
    for (const row of stored) {
      const { dist, cosine } = faceDistance(probe, row);
      if (dist < bestDist) {
        bestDist = dist;
        bestCosine = cosine;
      }
    }
  }

  const localOk =
    Number.isFinite(bestDist) &&
    bestDist <= OWNER_DIST_OK &&
    bestCosine >= OWNER_COS_OK;

  const {
    confirmOwnerFaceWithAi,
    inspectLiveAntiSpoof,
    isFaceAiEnabled,
  } = await import("./face-ai-verify");

  if (!isFaceAiEnabled()) {
    if (!localOk) {
      logger.info(
        { event: "face_owner_verify", ok: false, userId, dist: Number(bestDist.toFixed(4)) },
        "face owner local mismatch",
      );
      return notOwner;
    }
    return {
      ok: true,
      id: profile.id,
      userId: profile.userId,
      dist: bestDist,
      cosine: bestCosine,
    };
  }

  const anti = await inspectLiveAntiSpoof(liveSnapshot, "login");
  if (!anti.ok) {
    /** Spoof aniq — rad. Lokal juda yaxshi bo‘lsa ham telefon rasm bo‘lishi mumkin. */
    return { ok: false, error: anti.error, code: anti.code, fullName: name };
  }

  const ai = await confirmOwnerFaceWithAi({
    faceProfileId: profile.id,
    liveSnapshot,
    localDist: bestDist,
    localCosine: bestCosine,
  });

  if (ai.ok) {
    logger.info(
      {
        event: "face_owner_verify",
        ok: true,
        userId,
        mode: "ai",
        dist: Number(bestDist.toFixed(4)),
        confidence: ai.confidence,
      },
      "face owner AI ok",
    );
    return {
      ok: true,
      id: profile.id,
      userId: profile.userId,
      dist: bestDist,
      cosine: bestCosine,
    };
  }

  /** AI rad etdi, lekin lokal aniq mos — egasi (yorug‘lik farqi). */
  if (localOk && ai.code !== "face_ai_spoof") {
    logger.info(
      {
        event: "face_owner_verify",
        ok: true,
        userId,
        mode: "local_fallback",
        dist: Number(bestDist.toFixed(4)),
        aiCode: ai.code,
      },
      "face owner local ok after AI uncertain",
    );
    return {
      ok: true,
      id: profile.id,
      userId: profile.userId,
      dist: bestDist,
      cosine: bestCosine,
    };
  }

  /** AI «boshqa odam» deb aniq aytdi yoki lokal ham uzoq. */
  if (ai.code === "face_ai_mismatch" || !localOk) {
    logger.info(
      {
        event: "face_owner_verify",
        ok: false,
        userId,
        code: ai.code,
        dist: Number(bestDist.toFixed(4)),
      },
      "face owner mismatch",
    );
    return notOwner;
  }

  return {
    ok: false,
    error: ai.error || "Yuzni qayta tekshiring — yorug‘ joyda kameraga tik qarang.",
    code: ai.code || "face_ai_mismatch",
    fullName: name,
  };
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function parseStoredVectors(raw: string): number[][] {
  return parseStoredList(raw);
}

export function minDistanceBetweenVectors(aList: number[][], bList: number[][]): number | null {
  let best: number | null = null;
  for (const a of aList) {
    for (const b of bList) {
      const d = faceDistance(a, b).dist;
      if (best == null || d < best) best = d;
    }
  }
  return best;
}

export function distanceBetweenDescriptors(aJson: string, bJson: string): number | null {
  return minDistanceBetweenVectors(parseStoredList(aJson), parseStoredList(bJson));
}
