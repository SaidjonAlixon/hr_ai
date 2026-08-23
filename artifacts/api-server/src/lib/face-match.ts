import { eq, inArray } from "drizzle-orm";
import { db, faceProfilesTable, usersTable } from "@workspace/db";

export const FACE_DESCRIPTOR_LEN = 128;
/** Davomat / login: faqat deyarli o‘sha odam (boshqasi o‘xshamasin) */
export const FACE_MATCH_MAX = 0.26;
/** Cosine: shundan past — boshqa odam */
export const FACE_MATCH_MIN_COSINE = 0.968;
/** Eng yaqin va 2-yaqin orasidagi farq shundan kichik — noaniq */
export const FACE_AMBIGUOUS_MARGIN = 0.1;
/** Eng yaqin / 2-yaqin nisbati shundan katta — ikki profil aralashadi */
export const FACE_AMBIGUOUS_RATIO = 0.62;
/** Ro‘yxat: boshqa xodimga yaqin yuz bloklanadi */
export const FACE_ENROLL_BLOCK_MAX = 0.28;
/** Admin: o‘xshash juftlik ogohlantiruvi */
export const FACE_SIMILAR_WARN = 0.36;

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
    const stored = JSON.parse(raw) as unknown;
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
