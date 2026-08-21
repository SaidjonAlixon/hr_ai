import { eq, inArray } from "drizzle-orm";
import { db, faceProfilesTable, usersTable } from "@workspace/db";

export const FACE_DESCRIPTOR_LEN = 128;
/** Davomat / login: shu masofadan uzoq bo‘lsa — mos emas */
export const FACE_MATCH_MAX = 0.38;
/** Eng yaqin va 2-yaqin orasidagi farq shundan kichik bo‘lsa — noaniq */
export const FACE_AMBIGUOUS_MARGIN = 0.12;
/** Ro‘yxatdan o‘tish: boshqa xodimga shu masofadan yaqin bo‘lsa — taqiqlanadi */
export const FACE_ENROLL_BLOCK_MAX = 0.45;

export function parseFaceDescriptor(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== FACE_DESCRIPTOR_LEN) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
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
    const stored = parseStored(row.descriptor);
    if (!stored) continue;
    rows.push({ id: row.id, userId: row.userId, descriptor: stored });
  }
  faceCache = { at: now, rows };
  return rows;
}

/** Enroll / delete dan keyin cache ni yangilash */
export function invalidateFaceCache(): void {
  faceCache = null;
}

function parseStored(raw: string): number[] | null {
  try {
    const stored = JSON.parse(raw) as number[];
    if (!Array.isArray(stored) || stored.length !== FACE_DESCRIPTOR_LEN) return null;
    return stored;
  } catch {
    return null;
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
    const dist = euclidean(descriptor, row.descriptor);
    if (!best || dist < best.dist) best = { id: row.id, userId: row.userId, dist };
  }
  if (!best || best.dist > maxDist) return null;
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
    const dist = euclidean(descriptor, row.descriptor);
    if (dist > maxDist) continue;
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
  for (const row of rows) {
    const dist = euclidean(descriptor, row.descriptor);
    const hit = { id: row.id, userId: row.userId, dist };
    if (!best || dist < best.dist) {
      second = best;
      best = hit;
    } else if (!second || dist < second.dist) {
      second = hit;
    }
  }

  if (!best || best.dist > FACE_MATCH_MAX) {
    return {
      ok: false,
      error: "Bu yuz aniqlanmadi. Avval tizimga kirib Face ID ni ro‘yxatdan o‘tkazing.",
      code: "face_not_registered",
    };
  }

  if (
    second &&
    second.dist - best.dist < FACE_AMBIGUOUS_MARGIN &&
    second.dist <= FACE_MATCH_MAX + 0.04
  ) {
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
  return euclidean(a, b);
}
